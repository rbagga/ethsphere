# Ethsphere Backend API

A high-performance Ethereum blockchain transaction tracking and analytics API built with Node.js, Express, and DuckDB.

## Features

- 🔥 **Real-time Transaction Tracking**: Continuously fetches and stores Ethereum transactions
- 📊 **Analytics API**: Query transactions by address, get statistics, and run custom queries
- 🗄️ **DuckDB Integration**: High-performance analytical database for transaction data
- 🚀 **Production Ready**: Docker support, health checks, and graceful shutdowns
- 🔒 **Secure Configuration**: Environment-based configuration with no hardcoded secrets
- ☁️ **Cloud Deployment**: Ready-to-deploy configurations for Railway, Render, and more

## Quick Start

### Local Development

1. **Clone and setup:**
   ```bash
   git clone <your-repo>
   cd ethsphere/backend
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your INFURA_API_KEY
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

The API will be available at `http://localhost:3001`

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t ethsphere-backend .
docker run -p 3001:3001 --env-file .env ethsphere-backend
```

## API Endpoints

### Blockchain Data
- `GET /` - API documentation and endpoint overview
- `GET /health` - Health check endpoint
- `GET /tx/:hash` - Get transaction details by hash
- `GET /balance/:address` - Get ETH balance for address
- `GET /pending-queue?n=100` - Get and remove N transactions from stack (legacy)

### Transaction Analytics
- `GET /transactions/recent?limit=100` - Get recent transactions from database
- `GET /transactions/address/:address?limit=100` - Get transactions for specific address
- `GET /transactions/stats` - Get transaction statistics
- `POST /query` - Execute custom SQL queries on transaction data

### Example Usage

```bash
# Get recent transactions
curl "http://localhost:3001/transactions/recent?limit=10"

# Get transactions for an address
curl "http://localhost:3001/transactions/address/0x742d35Cc6589C4532CE8aDd39fD3ab32d"

# Get transaction statistics
curl "http://localhost:3001/transactions/stats"

# Custom query (POST)
curl -X POST "http://localhost:3001/query" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT COUNT(*) as tx_count FROM transactions WHERE block_number > ?",
    "params": [18000000]
  }'
```

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `INFURA_API_KEY` | - | **Required** - Your Infura API key |
| `PORT` | 3001 | Server port |
| `ETHEREUM_NETWORK` | mainnet | Ethereum network (mainnet, goerli, etc.) |
| `STACK_CAPACITY` | 20000 | Max transactions in memory stack |
| `STACK_RESUME_THRESHOLD` | 5000 | Resume fetching below this count |
| `FETCH_INTERVAL_MS` | 1000 | Transaction fetching interval |
| `DEFAULT_QUERY_LIMIT` | 100 | Default API query limit |
| `MAX_QUERY_LIMIT` | 1000 | Maximum API query limit |

## Cloud Deployment

### Railway
1. Connect your GitHub repository to Railway
2. Add environment variables in Railway dashboard
3. Deploy automatically triggers on push

### Render
1. Create a new Web Service on Render
2. Connect your repository
3. Render will automatically detect the `render.yaml` configuration
4. Add environment variables in Render dashboard

### Other Platforms
The application includes a `Dockerfile` and health check endpoint, making it compatible with most cloud platforms that support Docker containers.

## Database Schema

Transactions are stored in DuckDB with the following schema:

```sql
CREATE TABLE transactions (
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
```

## Development

### Project Structure
```
src/
  ├── app.js          # Main application class
  ├── blockchain.js   # Ethereum blockchain service
  ├── config.js       # Configuration management
  ├── database.js     # DuckDB database operations
  └── routes.js       # API route definitions
server.js             # Application entry point
```

### Adding New Features
1. Extend the database schema in `src/database.js`
2. Add new API endpoints in `src/routes.js`
3. Update the blockchain service in `src/blockchain.js` if needed
4. Update this README with new endpoint documentation

## Security

- No API keys or secrets are committed to the repository
- All sensitive configuration is environment-based
- SQL injection protection on custom queries (SELECT only)
- Non-root user in Docker container
- Health checks and graceful shutdowns

## Performance

- DuckDB provides high-performance analytics on transaction data
- In-memory transaction stack for low-latency access
- Configurable fetching intervals and limits
- Efficient batch processing of transactions

## License

MIT