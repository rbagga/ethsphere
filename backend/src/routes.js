const express = require('express');
const config = require('./config');

// Helper function to convert BigInt values to strings for JSON serialization
function serializeResults(results) {
  return results.map(row => {
    const serializedRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') {
        serializedRow[key] = value.toString();
      } else {
        serializedRow[key] = value;
      }
    }
    return serializedRow;
  });
}

function createRoutes(blockchainService, database) {
  const router = express.Router();

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Legacy endpoint: Get and remove latest N transactions from the stack
  router.get('/pending-queue', (req, res) => {
    try {
      const n = Math.min(Number(req.query.n) || config.defaultQueryLimit, config.maxQueryLimit);
      const txs = blockchainService.popTransactions(n);
      res.json(txs);
    } catch (error) {
      console.error('Error in /pending-queue:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get transaction details by hash
  router.get('/tx/:hash', async (req, res) => {
    try {
      const tx = await blockchainService.getTransaction(req.params.hash);
      if (!tx) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      res.json(tx);
    } catch (error) {
      console.error('Error in /tx/:hash:', error);
      res.status(500).json({ error: 'Failed to fetch transaction', details: error.message });
    }
  });

  // Get ETH balance for an address
  router.get('/balance/:address', async (req, res) => {
    try {
      const balance = await blockchainService.getBalance(req.params.address);
      res.json({ balance });
    } catch (error) {
      console.error('Error in /balance/:address:', error);
      res.status(500).json({ error: 'Failed to fetch balance', details: error.message });
    }
  });

  // NEW: Query recent transactions from database
  router.get('/transactions/recent', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || config.defaultQueryLimit, config.maxQueryLimit);
      const transactions = await database.getRecentTransactions(limit);
      const serializedTransactions = serializeResults(transactions);
      res.json({
        count: serializedTransactions.length,
        transactions: serializedTransactions
      });
    } catch (error) {
      console.error('Error in /transactions/recent:', error);
      res.status(500).json({ error: 'Failed to fetch recent transactions', details: error.message });
    }
  });

  // NEW: Query transactions by address
  router.get('/transactions/address/:address', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || config.defaultQueryLimit, config.maxQueryLimit);
      const transactions = await database.getTransactionsByAddress(req.params.address, limit);
      const serializedTransactions = serializeResults(transactions);
      res.json({
        address: req.params.address,
        count: serializedTransactions.length,
        transactions: serializedTransactions
      });
    } catch (error) {
      console.error('Error in /transactions/address/:address:', error);
      res.status(500).json({ error: 'Failed to fetch transactions for address', details: error.message });
    }
  });

  // NEW: Get transaction statistics
  router.get('/transactions/stats', async (req, res) => {
    try {
      const stats = await database.getTransactionStats();
      const serializedStats = serializeResults([stats])[0]; // Serialize single object
      res.json(serializedStats);
    } catch (error) {
      console.error('Error in /transactions/stats:', error);
      res.status(500).json({ error: 'Failed to fetch transaction statistics', details: error.message });
    }
  });

  // NEW: Natural Language to SQL conversion endpoint  
  router.post('/nl-to-sql', async (req, res) => {
    try {
      const { naturalLanguage, sessionId, provider, model } = req.body;
      
      console.log(`[DEBUG] NL-to-SQL request received:`);
      console.log(`  - naturalLanguage: "${naturalLanguage}"`);
      console.log(`  - sessionId: ${sessionId || 'undefined'}`);
      console.log(`  - provider: ${provider || 'undefined'}`);
      console.log(`  - model: ${model || 'undefined'}`);
      
      if (!naturalLanguage) {
        return res.status(400).json({ error: 'Natural language query is required' });
      }
      
      // Get API key from session if sessionId provided
      let apiKey = null;
      if (sessionId && userSessions.has(sessionId)) {
        const session = userSessions.get(sessionId);
        try {
          // Decrypt the API key for use
          apiKey = session.isEncrypted ? decrypt(session.apiKey) : session.apiKey;
          // Update last used timestamp
          session.lastUsed = new Date();
          console.log(`[DEBUG] Using decrypted API key from session for ${session.provider}`);
        } catch (error) {
          console.error('[DEBUG] Failed to decrypt API key:', error.message);
          apiKey = null;
        }
      }

      // Database schema for context
      const schema = `
DATABASE SCHEMA: Ethereum Transactions
=====================================

Table: transactions
Primary Key: hash

COLUMNS:
--------
- hash (VARCHAR): Unique transaction hash (e.g., "0xf6a4d473e02742d102a11a2eb9743ba59928edcfc10e8c93480cbbaee6e9325c")
- block_number (BIGINT): Ethereum block number (e.g., 23093196 to 23098256)
- from_address (VARCHAR): Sender's Ethereum address (e.g., "0xf70da97812CB96acDF810712Aa562db8dfA3dbEF")
- to_address (VARCHAR): Recipient's Ethereum address (e.g., "0xc80DeD6B332336d71b1413678A6060E5deC6b985")
- value (VARCHAR): Transaction value in wei as string (e.g., "16152065921326045" = ~0.016 ETH)
- gas_price (VARCHAR): Gas price in wei as string (e.g., "1142345615")
- gas_limit (BIGINT): Gas limit for transaction (e.g., 25200)
- nonce (BIGINT): Sender's transaction nonce (e.g., 3163049)
- data (TEXT): Transaction data/input (hex string, e.g., "0x20e693741536447ae2a37b027c859acbf10d8edcdae67091e4308a5e4303037c")
- timestamp (TIMESTAMP): When transaction was mined (e.g., "2025-08-07T18:55:50.118Z")
- created_at (TIMESTAMP): When record was stored in database (e.g., "2025-08-07T18:55:50.118Z")

DATA CONTEXT:
------------
- Current dataset: ~22,620 transactions
- Block range: 23093196 to 23098256 (recent Ethereum mainnet)
- Time range: 2025-08-07 to 2025-08-08
- Value amounts are in wei (1 ETH = 1,000,000,000,000,000,000 wei)
- Gas prices are in wei per gas unit

IMPORTANT SQL NOTES:
------------------
1. VALUES ARE STRINGS: value and gas_price are stored as VARCHAR, use CAST(value AS BIGINT) for math
2. WEI CONVERSION: To convert wei to ETH, divide by 1000000000000000000 (18 zeros)
3. ADDRESS SEARCHES: Use LIKE or = for address matching, addresses are case-sensitive hex strings
4. TIME QUERIES: Both timestamp and created_at are TIMESTAMP fields, use standard SQL date functions
5. SORTING: Use ORDER BY created_at DESC for most recent, ORDER BY CAST(value AS BIGINT) DESC for highest value
6. NULL HANDLING: to_address can be NULL for contract creation transactions

EXAMPLE QUERIES:
--------------
- Recent transactions: SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10
- High value transactions: SELECT *, CAST(value AS BIGINT)/1000000000000000000.0 as eth_value FROM transactions WHERE CAST(value AS BIGINT) > 1000000000000000000 ORDER BY CAST(value AS BIGINT) DESC LIMIT 10
- Address activity: SELECT * FROM transactions WHERE from_address = '0x...' OR to_address = '0x...' ORDER BY created_at DESC
- Daily stats: SELECT DATE(created_at) as day, COUNT(*) as tx_count FROM transactions GROUP BY DATE(created_at) ORDER BY day DESC
      `;

      let sqlQuery;
      let usedProvider = 'rule-based';

      // Try the specified provider first if available
      if (provider && apiKey) {
        console.log(`[DEBUG] Using AI provider: ${provider} with model: ${model}`);
        try {
          sqlQuery = await convertWithProvider(naturalLanguage, schema, provider, model, apiKey);
          usedProvider = provider;
        } catch (error) {
          console.warn(`${provider} API failed, falling back to rule-based conversion:`, error.message);
          sqlQuery = convertNaturalLanguageToSQL(naturalLanguage.toLowerCase());
        }
      } else if (config.groqApiKey) {
        console.log(`[DEBUG] Using server-side Groq API key`);
        // Fallback to server-configured Groq
        try {
          sqlQuery = await convertWithGroq(naturalLanguage, schema);
          usedProvider = 'groq';
        } catch (error) {
          console.warn('Groq API failed, falling back to rule-based conversion:', error.message);
          sqlQuery = convertNaturalLanguageToSQL(naturalLanguage.toLowerCase());
        }
      } else {
        console.log(`[DEBUG] No AI provider available. Provider: ${provider}, ApiKey: ${apiKey ? 'present' : 'missing'}, ServerGroq: ${config.groqApiKey ? 'present' : 'missing'}`);
        // Fallback to rule-based conversion
        sqlQuery = convertNaturalLanguageToSQL(naturalLanguage.toLowerCase());
      }
      
      res.json({
        naturalLanguage,
        sqlQuery,
        schema,
        method: usedProvider,
        model: model || (usedProvider === 'groq' ? 'llama-3.1-70b-versatile' : null)
      });
    } catch (error) {
      console.error('Error in /nl-to-sql:', error);
      res.status(500).json({ error: 'Failed to convert natural language to SQL', details: error.message });
    }
  });

  // Generate improved prompt for all providers
  function generatePrompt(naturalLanguage, schema) {
    return `You are an expert SQL query generator specializing in Ethereum blockchain transaction analysis.

${schema}

CRITICAL INSTRUCTIONS:
=====================
1. RESPONSE FORMAT: Return ONLY the SQL query. No explanations, comments, or markdown formatting.

2. VALUE HANDLING: 
   - value and gas_price are VARCHAR (strings), use CAST(value AS DOUBLE) for very large values or TRY_CAST(value AS BIGINT) for safer conversion
   - To convert wei to ETH: CAST(value AS DOUBLE)/1000000000000000000.0
   - For comparisons with large values, use CAST(value AS DOUBLE)
   - Example: SELECT *, CAST(value AS DOUBLE)/1000000000000000000.0 as eth_value FROM transactions

3. ADDRESS QUERIES:
   - Ethereum addresses are case-sensitive hex strings starting with 0x
   - For "transactions from/to address X", search both: WHERE from_address = 'X' OR to_address = 'X'
   - Use exact matching with = operator, not LIKE unless pattern matching is needed

4. SORTING & LIMITS:
   - Time-based: ORDER BY created_at DESC (most recent first)
   - Value-based: ORDER BY CAST(value AS DOUBLE) DESC (highest value first)
   - Always add appropriate LIMIT clause (10-100 based on query context)

5. COMMON PATTERNS:
   - "Recent/latest transactions" → ORDER BY created_at DESC LIMIT 10
   - "Highest/largest transactions" → ORDER BY CAST(value AS DOUBLE) DESC LIMIT 10
   - "Today's transactions" → WHERE DATE(created_at) = CURRENT_DATE
   - "Transactions above X ETH" → WHERE CAST(value AS DOUBLE) > X*1000000000000000000

NATURAL LANGUAGE QUERY: "${naturalLanguage}"

Generate the SQL query:`;
  }

  // Multi-provider API integration
  async function convertWithProvider(naturalLanguage, schema, provider, model, apiKey) {
    switch (provider) {
      case 'groq':
        return await convertWithGroq(naturalLanguage, schema, model, apiKey);
      case 'openai':
        return await convertWithOpenAI(naturalLanguage, schema, model, apiKey);
      case 'claude':
        return await convertWithClaude(naturalLanguage, schema, model, apiKey);
      case 'gemini':
        return await convertWithGemini(naturalLanguage, schema, model, apiKey);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // Groq API integration
  async function convertWithGroq(naturalLanguage, schema, model = 'llama-3.1-70b-versatile', apiKey = config.groqApiKey) {
    const prompt = generatePrompt(naturalLanguage, schema);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent SQL generation
        max_tokens: 500,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Groq API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const sqlQuery = data.choices[0]?.message?.content?.trim();
    
    if (!sqlQuery) {
      throw new Error('No SQL query generated by Groq');
    }

    // Basic validation - ensure it's a SELECT statement
    if (!sqlQuery.toUpperCase().trim().startsWith('SELECT')) {
      throw new Error('Generated query is not a SELECT statement');
    }

    return sqlQuery;
  }

  // OpenAI API integration
  async function convertWithOpenAI(naturalLanguage, schema, model = 'gpt-4o-mini', apiKey) {
    const prompt = generatePrompt(naturalLanguage, schema);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const sqlQuery = data.choices[0]?.message?.content?.trim();
    
    if (!sqlQuery) {
      throw new Error('No SQL query generated by OpenAI');
    }

    if (!sqlQuery.toUpperCase().trim().startsWith('SELECT')) {
      throw new Error('Generated query is not a SELECT statement');
    }

    return sqlQuery;
  }

  // Claude API integration
  async function convertWithClaude(naturalLanguage, schema, model = 'claude-3-5-haiku-20241022', apiKey) {
    const prompt = generatePrompt(naturalLanguage, schema);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 500,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Claude API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const sqlQuery = data.content[0]?.text?.trim();
    
    if (!sqlQuery) {
      throw new Error('No SQL query generated by Claude');
    }

    if (!sqlQuery.toUpperCase().trim().startsWith('SELECT')) {
      throw new Error('Generated query is not a SELECT statement');
    }

    return sqlQuery;
  }

  // Gemini API integration
  async function convertWithGemini(naturalLanguage, schema, model = 'gemini-1.5-flash', apiKey) {
    const prompt = generatePrompt(naturalLanguage, schema);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const sqlQuery = data.candidates[0]?.content?.parts[0]?.text?.trim();
    
    if (!sqlQuery) {
      throw new Error('No SQL query generated by Gemini');
    }

    if (!sqlQuery.toUpperCase().trim().startsWith('SELECT')) {
      throw new Error('Generated query is not a SELECT statement');
    }

    return sqlQuery;
  }

  // Enhanced rule-based NL to SQL converter 
  function convertNaturalLanguageToSQL(nl) {
    console.log(`[DEBUG] Rule-based conversion for: "${nl}"`);
    
    // Large value patterns (check before recent patterns)
    if (nl.includes('large') || nl.includes('big') || nl.includes('expensive')) {
      return 'SELECT hash, from_address, to_address, CAST(value AS DOUBLE)/1000000000000000000.0 as eth_value FROM transactions WHERE CAST(value AS DOUBLE) > 100000000000000000 ORDER BY CAST(value AS DOUBLE) DESC LIMIT 10;';
    }
    
    // Recent/Latest transactions
    if (nl.includes('recent') || nl.includes('latest') || nl.includes('last') || nl.includes('past')) {
      if (nl.includes('5')) {
        return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 5;';
      }
      if (nl.includes('10') || nl.includes('ten')) {
        return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;';
      }
      if (nl.includes('hour') || nl.includes('today')) {
        return 'SELECT * FROM transactions WHERE created_at >= NOW() - INTERVAL 1 HOUR ORDER BY created_at DESC LIMIT 50;';
      }
      return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20;';
    }
    
    if (nl.includes('count') || nl.includes('how many')) {
      if (nl.includes('address')) {
        return 'SELECT COUNT(DISTINCT from_address) as unique_senders, COUNT(DISTINCT to_address) as unique_receivers FROM transactions;';
      }
      return 'SELECT COUNT(*) as total_transactions FROM transactions;';
    }
    
    if (nl.includes('top') || nl.includes('most active')) {
      if (nl.includes('sender')) {
        return 'SELECT from_address, COUNT(*) as tx_count FROM transactions GROUP BY from_address ORDER BY tx_count DESC LIMIT 10;';
      }
      if (nl.includes('receiver')) {
        return 'SELECT to_address, COUNT(*) as tx_count FROM transactions GROUP BY to_address ORDER BY tx_count DESC LIMIT 10;';
      }
      return 'SELECT from_address, COUNT(*) as tx_count FROM transactions GROUP BY from_address ORDER BY tx_count DESC LIMIT 10;';
    }
    
    if (nl.includes('value') || nl.includes('amount') || nl.includes('highest') || nl.includes('largest')) {
      if (nl.includes('average') || nl.includes('avg')) {
        return 'SELECT AVG(CAST(value AS DOUBLE)) as avg_value_wei, AVG(CAST(value AS DOUBLE))/1000000000000000000.0 as avg_value_eth FROM transactions WHERE CAST(value AS DOUBLE) > 0;';
      }
      if (nl.includes('highest') || nl.includes('max') || nl.includes('largest')) {
        return 'SELECT hash, from_address, to_address, CAST(value AS DOUBLE)/1000000000000000000.0 as eth_value FROM transactions WHERE CAST(value AS DOUBLE) > 0 ORDER BY CAST(value AS DOUBLE) DESC LIMIT 10;';
      }
      return 'SELECT hash, from_address, to_address, CAST(value AS DOUBLE)/1000000000000000000.0 as eth_value FROM transactions WHERE CAST(value AS DOUBLE) > 0 ORDER BY CAST(value AS DOUBLE) DESC LIMIT 10;';
    }
    
    if (nl.includes('today') || nl.includes('daily')) {
      return 'SELECT DATE(created_at) as date, COUNT(*) as daily_txs FROM transactions GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 7;';
    }
    
    if (nl.includes('gas')) {
      if (nl.includes('price')) {
        return 'SELECT AVG(CAST(gas_price AS DOUBLE)) as avg_gas_price, MAX(CAST(gas_price AS DOUBLE)) as max_gas_price FROM transactions;';
      }
      return 'SELECT hash, gas_price, gas_limit FROM transactions ORDER BY CAST(gas_price AS DOUBLE) DESC LIMIT 10;';
    }

    // Check for specific address
    const addressMatch = nl.match(/0x[a-fA-F0-9]{40}/);
    if (addressMatch) {
      const address = addressMatch[0];
      return `SELECT * FROM transactions WHERE from_address = '${address}' OR to_address = '${address}' ORDER BY created_at DESC LIMIT 20;`;
    }
    
    // Additional patterns
    if (nl.includes('show') && (nl.includes('transaction') || nl.includes('tx'))) {
      if (nl.includes('5')) {
        return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 5;';
      }
      if (nl.includes('10')) {
        return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;';
      }
      return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 20;';
    }
    
    
    // ETH amount patterns
    const ethMatch = nl.match(/([\d.]+)\s*eth/i);
    if (ethMatch) {
      const ethAmount = parseFloat(ethMatch[1]);
      const weiAmount = ethAmount * 1000000000000000000;
      return `SELECT hash, from_address, to_address, CAST(value AS DOUBLE)/1000000000000000000.0 as eth_value FROM transactions WHERE CAST(value AS DOUBLE) > ${weiAmount} ORDER BY CAST(value AS DOUBLE) DESC LIMIT 10;`;
    }
    
    // Time-based patterns
    if (nl.includes('hour')) {
      return 'SELECT * FROM transactions WHERE created_at >= NOW() - INTERVAL 1 HOUR ORDER BY created_at DESC LIMIT 50;';
    }
    
    console.log(`[DEBUG] No pattern matched, using default fallback`);
    // Default fallback
    return 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;';
  }

  // NEW: Secure provider authentication endpoints
  const userSessions = new Map(); // Store user sessions in memory (use Redis in production)
  
  // Secure authentication configuration
  const crypto = require('crypto');
  
  // Encryption for API keys
  const encrypt = (text) => {
    try {
      const secretKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32chars';
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(secretKey, 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt API key');
    }
  };
  
  const decrypt = (encryptedText) => {
    try {
      const secretKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32chars';
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(secretKey, 'salt', 32);
      const textParts = encryptedText.split(':');
      const iv = Buffer.from(textParts.shift(), 'hex');
      const encryptedData = textParts.join(':');
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt API key');
    }
  };
  
  // Authenticate user with provider (secure server-side)
  router.post('/auth/connect', async (req, res) => {
    try {
      const { provider, apiKey, userId } = req.body;
      
      if (!provider || !apiKey) {
        return res.status(400).json({ error: 'Provider and API key required' });
      }
      
      // Generate a user ID if not provided (in production, use proper user auth)
      const sessionUserId = userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Test the API key by making a simple request
      let isValid = false;
      try {
        switch (provider) {
          case 'openai':
            const openaiResponse = await fetch('https://api.openai.com/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            isValid = openaiResponse.ok;
            break;
          case 'groq':
            const groqResponse = await fetch('https://api.groq.com/openai/v1/models', {
              headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            isValid = groqResponse.ok;
            break;
          case 'claude':
            // Claude doesn't have a simple models endpoint, so we'll assume valid for now
            isValid = apiKey.startsWith('sk-');
            break;
          case 'gemini':
            // Test with a simple request
            const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            isValid = geminiResponse.ok;
            break;
          default:
            return res.status(400).json({ error: 'Unsupported provider' });
        }
      } catch (error) {
        console.warn(`Failed to validate ${provider} API key:`, error.message);
        isValid = false;
      }
      
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid API key for provider' });
      }
      
      // Store the encrypted API key server-side with session ID
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const encryptedApiKey = encrypt(apiKey);
      
      userSessions.set(sessionId, {
        provider,
        apiKey: encryptedApiKey, // Store encrypted
        userId: sessionUserId,
        createdAt: new Date(),
        lastUsed: new Date(),
        isEncrypted: true
      });
      
      console.log(`[AUTH] User ${sessionUserId} connected to ${provider}`);
      
      res.json({
        success: true,
        sessionId,
        userId: sessionUserId,
        provider,
        message: `Successfully connected to ${provider}`
      });
    } catch (error) {
      console.error('Error in /auth/connect:', error);
      res.status(500).json({ error: 'Authentication failed', details: error.message });
    }
  });
  
  // Disconnect user from provider
  router.post('/auth/disconnect', (req, res) => {
    const { sessionId } = req.body;
    
    if (sessionId && userSessions.has(sessionId)) {
      const session = userSessions.get(sessionId);
      userSessions.delete(sessionId);
      console.log(`[AUTH] User ${session.userId} disconnected from ${session.provider}`);
      res.json({ success: true, message: 'Disconnected successfully' });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });
  
  // Get user's connected providers
  router.get('/auth/status/:userId', (req, res) => {
    const { userId } = req.params;
    const userProviders = [];
    
    for (const [sessionId, session] of userSessions.entries()) {
      if (session.userId === userId) {
        userProviders.push({
          sessionId,
          provider: session.provider,
          connectedAt: session.createdAt,
          lastUsed: session.lastUsed
        });
      }
    }
    
    res.json({ userId, providers: userProviders });
  });

  // Special secure OpenAI authentication with enhanced validation
  router.post('/auth/openai/secure-login', async (req, res) => {
    try {
      const { apiKey, userId } = req.body;
      
      if (!apiKey || !apiKey.startsWith('sk-')) {
        return res.status(400).json({ error: 'Valid OpenAI API key required (starts with sk-)' });
      }
      
      // Enhanced OpenAI validation - use basic models endpoint (most reliable)
      let userInfo = null;
      let isValid = false;
      
      try {
        console.log('[DEBUG] Validating OpenAI API key...');
        
        // Test with models endpoint (most basic, reliable endpoint)
        const modelsResponse = await fetch('https://api.openai.com/v1/models', {
          headers: { 
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': 'EthsphereApp/1.0'
          }
        });
        
        console.log('[DEBUG] Models response status:', modelsResponse.status);
        
        if (modelsResponse.ok) {
          const models = await modelsResponse.json();
          isValid = true;
          
          const availableModels = models.data
            ?.filter(m => m.id.includes('gpt'))
            ?.slice(0, 5)
            ?.map(m => m.id) || [];
            
          userInfo = {
            hasModelsAccess: true,
            availableModels: availableModels,
            totalModels: models.data?.length || 0
          };
          
          console.log('[DEBUG] OpenAI validation successful, available models:', availableModels.length);
        } else {
          const errorText = await modelsResponse.text();
          console.log('[DEBUG] OpenAI validation failed:', modelsResponse.status, errorText);
        }
      } catch (error) {
        console.warn('[DEBUG] OpenAI validation error:', error.message);
        isValid = false;
      }
      
      if (!isValid) {
        return res.status(401).json({ 
          error: 'Invalid OpenAI API key or API access denied',
          suggestion: 'Please verify: 1) API key is correct, 2) API key has usage credits, 3) API key is not restricted',
          debug: 'Check server logs for detailed error information'
        });
      }
      
      // Generate secure session with enhanced data
      const sessionUserId = userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const sessionId = `openai_secure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const encryptedApiKey = encrypt(apiKey);
      
      userSessions.set(sessionId, {
        provider: 'openai',
        apiKey: encryptedApiKey,
        userId: sessionUserId,
        createdAt: new Date(),
        lastUsed: new Date(),
        isEncrypted: true,
        secureLogin: true,
        userInfo: userInfo
      });
      
      console.log(`[SECURE AUTH] OpenAI secure login successful for user ${sessionUserId}`);
      
      res.json({
        success: true,
        sessionId,
        userId: sessionUserId,
        provider: 'openai',
        secureLogin: true,
        userInfo: userInfo,
        message: 'Successfully connected to OpenAI with secure authentication'
      });
      
    } catch (error) {
      console.error('Error in OpenAI secure login:', error);
      res.status(500).json({ 
        error: 'Secure authentication failed', 
        details: error.message 
      });
    }
  });

  // NEW: Debug endpoint to test authentication
  router.post('/test-auth', (req, res) => {
    const { naturalLanguage, provider, model, apiKey } = req.body;
    
    console.log(`[DEBUG] Test auth request received:`);
    console.log(`  - provider: ${provider || 'undefined'}`);
    console.log(`  - model: ${model || 'undefined'}`);
    console.log(`  - apiKey: ${apiKey ? `present (${apiKey.length} chars)` : 'missing'}`);
    
    res.json({
      received: {
        provider: provider || null,
        model: model || null,
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey ? apiKey.length : 0
      }
    });
  });

  // NEW: Get available providers and models
  router.get('/providers', (req, res) => {
    const providers = {
      groq: {
        name: 'Groq',
        models: [
          { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B Versatile', recommended: true },
          { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
          { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
          { id: 'llama-3.2-90b-text-preview', name: 'Llama 3.2 90B Preview' },
          { id: 'llama-3.2-11b-text-preview', name: 'Llama 3.2 11B Preview' }
        ],
        requiresApiKey: true,
        signupUrl: 'https://console.groq.com',
        description: 'Fast inference with open-source models'
      },
      openai: {
        name: 'OpenAI',
        models: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', recommended: true },
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
        ],
        requiresApiKey: true,
        signupUrl: 'https://platform.openai.com/api-keys',
        description: 'Industry-leading language models from OpenAI'
      },
      claude: {
        name: 'Claude (Anthropic)',
        models: [
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', recommended: true },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
        ],
        requiresApiKey: true,
        signupUrl: 'https://console.anthropic.com',
        description: 'Constitutional AI with strong reasoning capabilities'
      },
      gemini: {
        name: 'Google Gemini',
        models: [
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', recommended: true },
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          { id: 'gemini-pro', name: 'Gemini Pro' }
        ],
        requiresApiKey: true,
        signupUrl: 'https://aistudio.google.com/app/apikey',
        description: 'Google\'s multimodal AI with strong reasoning'
      }
    };

    res.json(providers);
  });

  // NEW: Custom SQL query endpoint (be careful with this in production)
  router.post('/query', async (req, res) => {
    try {
      const { sql, params = [] } = req.body;
      
      if (!sql) {
        return res.status(400).json({ error: 'SQL query is required' });
      }

      // Basic security: only allow SELECT statements
      if (!sql.trim().toUpperCase().startsWith('SELECT')) {
        return res.status(400).json({ error: 'Only SELECT queries are allowed' });
      }

      const results = await database.query(sql, params);
      const serializedResults = serializeResults(results);
      
      res.json({
        rowCount: serializedResults.length,
        results: serializedResults
      });
    } catch (error) {
      console.error('Error in /query:', error);
      res.status(500).json({ error: 'Query execution failed', details: error.message });
    }
  });

  return router;
}

module.exports = createRoutes;