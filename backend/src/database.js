const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

class TransactionDatabase {
  constructor() {
    this.db = null;
    this.conn = null;
  }

  async initialize() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.join(__dirname, '..', 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Create database file path
      const dbPath = path.join(dataDir, 'transactions.duckdb');
      
      // Create database instance
      this.db = new duckdb.Database(dbPath);
      this.conn = this.db.connect();

      // Create tables
      await this.createTables();
      
      console.log('DuckDB initialized successfully');
    } catch (error) {
      console.error('Failed to initialize DuckDB:', error);
      throw error;
    }
  }

  async createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS transactions (
        hash VARCHAR PRIMARY KEY,
        block_number BIGINT,
        from_address VARCHAR,
        to_address VARCHAR,
        value VARCHAR,
        gas_price VARCHAR,
        gas_limit BIGINT,
        nonce BIGINT,
        data TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.conn.run(createTableSQL, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async insertTransaction(tx) {
    const insertSQL = `
      INSERT OR REPLACE INTO transactions 
      (hash, block_number, from_address, to_address, value, gas_price, gas_limit, nonce, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      tx.hash,
      tx.blockNumber,
      tx.from,
      tx.to,
      tx.value ? tx.value.toString() : '0',
      tx.gasPrice ? tx.gasPrice.toString() : '0',
      tx.gasLimit ? tx.gasLimit.toString() : '0',
      tx.nonce,
      tx.data || ''
    ];

    return new Promise((resolve, reject) => {
      this.conn.run(insertSQL, ...params, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async insertTransactions(transactions) {
    try {
      // Use batch insert for better performance
      const promises = transactions.map(tx => this.insertTransaction(tx));
      await Promise.all(promises);
    } catch (error) {
      throw error;
    }
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results || []);
      });
    });
  }

  async getRecentTransactions(limit = 100) {
    const sql = `
      SELECT * FROM transactions 
      ORDER BY created_at DESC 
      LIMIT ?
    `;
    return this.query(sql, [limit]);
  }

  async getTransactionsByAddress(address, limit = 100) {
    const sql = `
      SELECT * FROM transactions 
      WHERE from_address = ? OR to_address = ?
      ORDER BY created_at DESC 
      LIMIT ?
    `;
    return this.query(sql, [address, address, limit]);
  }

  async getTransactionStats() {
    const sql = `
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(DISTINCT from_address) as unique_senders,
        COUNT(DISTINCT to_address) as unique_receivers,
        AVG(CAST(value AS BIGINT)) as avg_value,
        MAX(block_number) as latest_block,
        MIN(block_number) as earliest_block
      FROM transactions
    `;
    const results = await this.query(sql);
    return results[0] || {};
  }

  close() {
    try {
      if (this.conn) {
        this.conn.close();
        this.conn = null;
      }
      if (this.db) {
        this.db.close();
        this.db = null;
      }
    } catch (error) {
      console.error('Error during database cleanup:', error);
    }
  }
}

module.exports = TransactionDatabase;