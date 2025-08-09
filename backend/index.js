// backend/index.js
require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

// Use InfuraProvider with just the API key
const provider = new ethers.providers.InfuraProvider('mainnet', process.env.INFURA_API_KEY);

// Stack (LIFO) for pending transactions
const STACK_CAP = 20000;
const STACK_RESUME_THRESHOLD = 5000;
let pendingStack = [];
let fetchingEnabled = true;

// Helper: add transactions to stack, capped
function addToStack(txs) {
  const hashes = txs.map(tx => tx.hash);
  pendingStack.push(...hashes);
  if (pendingStack.length > STACK_CAP) {
    pendingStack = pendingStack.slice(-STACK_CAP);
  }
  if (pendingStack.length >= STACK_CAP) {
    fetchingEnabled = false;
  }
}

// Fetch latest transactions every 30 seconds, only if enabled
async function fetchLatestTransactions() {
  if (!fetchingEnabled) return;
  try {
    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlockWithTransactions(blockNumber);
    if (block && block.transactions && block.transactions.length > 0) {
      addToStack(block.transactions);
      console.log(`[${new Date().toISOString()}] Added ${block.transactions.length} txs from block ${blockNumber}. Stack size: ${pendingStack.length}`);
    }
  } catch (err) {
    console.error('Error fetching latest transactions:', err);
  }
}

// Start polling
setInterval(fetchLatestTransactions, 1000);
fetchLatestTransactions(); // Initial fetch

// Endpoint to get and remove latest N transactions from the stack
app.get('/pending-queue', (req, res) => {
  const n = Math.min(Number(req.query.n) || 100, pendingStack.length);
  // Pop N transactions from the end (LIFO)
  const txs = [];
  for (let i = 0; i < n; ++i) {
    const popped = pendingStack.pop();
    if (popped !== undefined) txs.push(popped);
  }
  // If stack drops below resume threshold, re-enable fetching
  if (pendingStack.length < STACK_RESUME_THRESHOLD) {
    fetchingEnabled = true;
  }
  res.json(txs);
});

// Endpoint to get transaction details by hash
app.get('/tx/:hash', async (req, res) => {
  try {
    const tx = await provider.getTransaction(req.params.hash);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transaction', details: err.message });
  }
});

// Endpoint to get ETH balance for an address
app.get('/balance/:address', async (req, res) => {
  try {
    const balance = await provider.getBalance(req.params.address);
    res.json({ balance: balance.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
}); 