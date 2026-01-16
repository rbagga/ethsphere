require('dotenv').config();

const config = {
  // Server configuration
  port: process.env.PORT || 3001,
  
  // Ethereum configuration
  infuraApiKeys: process.env.INFURA_API_KEYS ? process.env.INFURA_API_KEYS.split(',') : [process.env.INFURA_API_KEY],
  network: process.env.ETHEREUM_NETWORK || 'mainnet',
  
  // Transaction processing configuration
  stackCapacity: parseInt(process.env.STACK_CAPACITY) || 20000,
  stackResumeThreshold: parseInt(process.env.STACK_RESUME_THRESHOLD) || 5000,
  fetchIntervalMs: parseInt(process.env.FETCH_INTERVAL_MS) || 1000,
  
  // Database configuration
  databasePath: process.env.DATABASE_PATH || './data/transactions.duckdb',
  
  // API configuration
  defaultQueryLimit: parseInt(process.env.DEFAULT_QUERY_LIMIT) || 100,
  maxQueryLimit: parseInt(process.env.MAX_QUERY_LIMIT) || 1000,
  
  // Groq LLM configuration
  groqApiKey: process.env.GROQ_API_KEY,
  
  // CORS and frontend configuration
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Add common production hosts by default; can be overridden via ALLOWED_ORIGINS
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://ethsphere.vercel.app',
        // These are broad hints; matching is handled in app.js (vercel.app substring)
        'https://ethsphere-production.up.railway.app'
      ],
  
  // Security configuration
  encryptionKey: process.env.ENCRYPTION_KEY,
};

// Validation
function validateConfig() {
  const errors = [];
  
  if (!config.infuraApiKeys || config.infuraApiKeys.length === 0 || config.infuraApiKeys[0] === undefined) {
    errors.push('INFURA_API_KEY or INFURA_API_KEYS is required');
  }
  
  if (!config.encryptionKey || config.encryptionKey.length < 32) {
    errors.push('ENCRYPTION_KEY is required and must be at least 32 characters');
  }
  
  if (config.stackCapacity <= config.stackResumeThreshold) {
    errors.push('STACK_CAPACITY must be greater than STACK_RESUME_THRESHOLD');
  }
  
  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
}

validateConfig();

module.exports = config;
