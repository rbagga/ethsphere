const { ethers } = require('ethers');
const config = require('./config');

class BlockchainService {
  constructor(database) {
    this.database = database;
    this.provider = new ethers.providers.InfuraProvider(config.network, config.infuraApiKey);
    
    // Transaction stack (for backward compatibility)
    this.pendingStack = [];
    this.fetchingEnabled = true;
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
        data: tx.data || ''
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
      const blockNumber = await this.provider.getBlockNumber();
      const block = await this.provider.getBlockWithTransactions(blockNumber);
      
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
      return await this.provider.getTransaction(hash);
    } catch (error) {
      throw new Error(`Failed to fetch transaction: ${error.message}`);
    }
  }

  // Get ETH balance for address
  async getBalance(address) {
    try {
      const balance = await this.provider.getBalance(address);
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