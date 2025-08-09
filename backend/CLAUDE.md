# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

This is a Node.js backend service for the Ethsphere project that provides Ethereum blockchain data via REST API with DuckDB analytics. The application is structured as a modular Express server with the following components:

### Core Components

**Main Application (`src/app.js`):**
- `EthsphereApp`: Main application class that orchestrates all components
- Handles initialization, middleware setup, routing, and graceful shutdowns

**Database Layer (`src/database.js`):**
- `TransactionDatabase`: DuckDB integration for persistent transaction storage
- Provides methods for querying transactions, statistics, and custom SQL execution
- Schema includes transaction hash, addresses, values, gas info, and timestamps

**Blockchain Service (`src/blockchain.js`):**
- `BlockchainService`: Manages Ethereum connection via Infura
- Fetches transactions every second and stores in both DuckDB and memory stack
- Maintains backward compatibility with legacy stack-based API

**Configuration (`src/config.js`):**
- Environment-based configuration with validation
- Supports all aspects: server, blockchain, database, and API settings

**Routes (`src/routes.js`):**
- Modular route definitions for both legacy and new analytics endpoints
- Includes transaction queries, statistics, custom SQL, and blockchain data

### Key Endpoints

**Analytics Endpoints:**
- `GET /transactions/recent?limit=100`: Recent transactions from database
- `GET /transactions/address/:address?limit=100`: Transactions for specific address  
- `GET /transactions/stats`: Transaction statistics and aggregations
- `POST /query`: Custom SQL queries (SELECT only for security)

**Legacy Blockchain Endpoints:**
- `GET /pending-queue?n=100`: LIFO transaction stack (backward compatibility)
- `GET /tx/:hash`: Transaction details by hash
- `GET /balance/:address`: ETH balance for address

## Common Commands

**Development:**
```bash
npm start        # Start the server
npm run dev      # Development mode (same as start)
```

**Docker:**
```bash
docker-compose up -d    # Run with Docker Compose
docker build -t ethsphere-backend .  # Build Docker image
```

**Environment Setup:**
- Copy `.env.example` to `.env`
- Required: `INFURA_API_KEY=your_infura_api_key`
- Optional: Configure other settings as needed

## Dependencies

- **Express 5.1.0**: Web framework
- **Ethers.js 5.8.0**: Ethereum library (v5 specifically, not v6)
- **DuckDB**: High-performance analytics database
- **CORS**: Cross-origin resource sharing
- **Dotenv**: Environment variable management

## Important Notes

- **Database Persistence**: Transactions are now stored in DuckDB for persistent analytics
- **Dual Storage**: Maintains both DuckDB storage and in-memory stack for compatibility
- **Modular Architecture**: Code is organized into separate modules for maintainability
- **Environment-Based**: All configuration via environment variables, no hardcoded secrets
- **Docker Ready**: Includes Dockerfile and docker-compose for easy deployment
- **Cloud Deploy**: Ready-to-deploy configurations for Railway, Render, and other platforms
- **Security**: SQL injection protection, non-root container user, SELECT-only custom queries

## Development Patterns

- Configuration changes go in `src/config.js`
- New API endpoints go in `src/routes.js`
- Database operations go in `src/database.js`
- Blockchain interactions go in `src/blockchain.js`
- Use the existing error handling patterns and logging
- Follow the established async/await patterns throughout