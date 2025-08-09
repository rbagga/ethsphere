const express = require('express');
const cors = require('cors');
const TransactionDatabase = require('./database');
const BlockchainService = require('./blockchain');
const createRoutes = require('./routes');
const config = require('./config');

class EthsphereApp {
  constructor() {
    this.app = express();
    this.database = null;
    this.blockchainService = null;
  }

  async initialize() {
    try {
      // Initialize database
      console.log('Initializing database...');
      this.database = new TransactionDatabase();
      await this.database.initialize();

      // Initialize blockchain service
      console.log('Initializing blockchain service...');
      this.blockchainService = new BlockchainService(this.database);

      // Setup Express middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Start blockchain fetching
      this.blockchainService.startFetching();

      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }

  setupMiddleware() {
    // Configure CORS based on environment
    const corsOptions = {
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        // In production, be more strict
        if (process.env.NODE_ENV === 'production') {
          return callback(new Error('Not allowed by CORS'), false);
        }
        
        // In development, allow all origins
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    };
    
    this.app.use(cors(corsOptions));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // API routes
    this.app.use('/api', createRoutes(this.blockchainService, this.database));
    
    // Legacy routes (without /api prefix for backward compatibility)
    this.app.use('/', createRoutes(this.blockchainService, this.database));

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Ethsphere Backend API',
        version: '2.0.0',
        description: 'Ethereum transaction tracking and analytics API',
        endpoints: {
          health: '/health',
          transactions: {
            recent: '/transactions/recent?limit=100',
            byAddress: '/transactions/address/:address?limit=100',
            stats: '/transactions/stats',
            query: 'POST /query'
          },
          blockchain: {
            pendingQueue: '/pending-queue?n=100',
            transaction: '/tx/:hash',
            balance: '/balance/:address'
          }
        }
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('Global error handler:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(config.port, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log(`🚀 Ethsphere Backend listening on port ${config.port}`);
        console.log(`📊 API Documentation available at http://localhost:${config.port}/`);
        resolve(server);
      });
    });
  }

  async shutdown() {
    console.log('Shutting down application...');
    
    if (this.blockchainService) {
      this.blockchainService.stopFetching();
    }
    
    if (this.database) {
      this.database.close();
    }
    
    console.log('Application shut down complete');
  }
}

module.exports = EthsphereApp;