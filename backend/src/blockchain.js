const { ethers } = require('ethers');
const config = require('./config');

class BlockchainService {
  constructor(database) {
    this.database = database;
    
    // API key rotation setup
    this.apiKeys = config.infuraApiKeys;
    this.currentKeyIndex = 0;
    this.provider = new ethers.providers.InfuraProvider(config.network, this.apiKeys[this.currentKeyIndex]);
    
    // Transaction stack (for backward compatibility)
    this.pendingStack = [];
    this.fetchingEnabled = true;
    
    console.log(`Initialized with ${this.apiKeys.length} Infura API key(s)`);
  }

  // Rotate to the next API key
  rotateApiKey() {
    if (this.apiKeys.length <= 1) {
      console.warn('Only one API key available, cannot rotate');
      return false;
    }
    
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    const newApiKey = this.apiKeys[this.currentKeyIndex];
    this.provider = new ethers.providers.InfuraProvider(config.network, newApiKey);
    
    console.log(`Rotated to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
    return true;
  }

  // Execute a provider method with automatic retry and key rotation
  async executeWithRetry(method, ...args) {
    const maxRetries = this.apiKeys.length;
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.provider[method](...args);
      } catch (error) {
        lastError = error;
        
        // Check if error is rate limit related
        const isRateLimitError = error.message?.includes('rate limit') || 
                               error.message?.includes('429') ||
                               error.code === 429 ||
                               error.status === 429;
        
        if (isRateLimitError && attempt < maxRetries - 1) {
          console.warn(`Rate limit hit on API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}, rotating...`);
          this.rotateApiKey();
          // Brief delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  // Add transactions to stack and database
  async addToStack(transactions) {
    try {
      // Format transactions for database compatibility
      const formattedTransactions = transactions.map(tx => ({
        hash: tx.hash,
        blockNumber: tx.blockNumber,
        from: tx.from,
        to: tx.to,
        value: tx.value || '0',
        gasPrice: tx.gasPrice || '0',
        gasLimit: tx.gasLimit || 0,
        nonce: tx.nonce || 0,
        // Avoid storing full calldata to reduce memory/disk usage
        data: ''
      }));
      
      // Add to database
      await this.database.insertTransactions(formattedTransactions);
      
      // Add to in-memory stack for backward compatibility
      const hashes = transactions.map(tx => tx.hash);
      this.pendingStack.push(...hashes);
      
      if (this.pendingStack.length > config.stackCapacity) {
        this.pendingStack = this.pendingStack.slice(-config.stackCapacity);
      }
      
      if (this.pendingStack.length >= config.stackCapacity) {
        this.fetchingEnabled = false;
      }
      
      console.log(`[${new Date().toISOString()}] Added ${transactions.length} txs to database. Stack size: ${this.pendingStack.length}`);
    } catch (error) {
      console.error('Error adding transactions to stack/database:', error);
    }
  }

  // Fetch latest transactions from blockchain
  async fetchLatestTransactions() {
    if (!this.fetchingEnabled) return;
    
    try {
      const blockNumber = await this.executeWithRetry('getBlockNumber');
      const block = await this.executeWithRetry('getBlockWithTransactions', blockNumber);
      
      if (block && block.transactions && block.transactions.length > 0) {
        await this.addToStack(block.transactions);
      }
    } catch (error) {
      console.error('Error fetching latest transactions:', error);
    }
  }

  // Get and remove transactions from stack (for backward compatibility)
  popTransactions(count = 100) {
    const n = Math.min(count, this.pendingStack.length);
    const txs = [];
    
    for (let i = 0; i < n; i++) {
      const popped = this.pendingStack.pop();
      if (popped !== undefined) txs.push(popped);
    }
    
    // Re-enable fetching if below threshold
    if (this.pendingStack.length < config.stackResumeThreshold) {
      this.fetchingEnabled = true;
    }
    
    return txs;
  }

  // Get transaction details by hash
  async getTransaction(hash) {
    try {
      return await this.executeWithRetry('getTransaction', hash);
    } catch (error) {
      throw new Error(`Failed to fetch transaction: ${error.message}`);
    }
  }

  // Get ETH balance for address
  async getBalance(address) {
    try {
      const balance = await this.executeWithRetry('getBalance', address);
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to fetch balance: ${error.message}`);
    }
  }

  // Start the transaction fetching process
  startFetching() {
    console.log(`Starting transaction fetching every ${config.fetchIntervalMs}ms`);
    
    // Initial fetch
    this.fetchLatestTransactions();
    
    // Set up interval
    this.fetchInterval = setInterval(() => {
      this.fetchLatestTransactions();
    }, config.fetchIntervalMs);
  }

  // Stop the transaction fetching process
  stopFetching() {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
    }
  }
}

module.exports = BlockchainService;
