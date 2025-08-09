# Ethsphere - Ethereum Transaction Visualizer

A real-time 3D visualization of Ethereum transactions with AI-powered natural language SQL queries and comprehensive analytics.

## 🚀 Quick Start

### Local Development

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your Infura API key and other configurations
npm start
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000` to see the application.

## 🌐 Deployment Options

### Option 1: Railway (Recommended - Full Stack)
1. Create account at [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Deploy backend using the existing `deploy/railway.json` configuration
4. Deploy frontend as a separate service
5. Set environment variables:
   - Backend: `INFURA_API_KEY`, `ENCRYPTION_KEY`, `FRONTEND_URL`, `ALLOWED_ORIGINS`
   - Frontend: `VITE_API_BASE_URL` (your backend URL)

### Option 2: Render
1. Create account at [render.com](https://render.com)
2. Deploy backend as Web Service using `deploy/render.yaml`
3. Deploy frontend as Static Site
4. Configure environment variables as above

### Option 3: Vercel + Railway (Hybrid)
1. **Backend on Railway**: Use Railway for the backend (better for Node.js + database)
2. **Frontend on Vercel**: Deploy frontend to Vercel for optimal React performance
3. Update `VITE_API_BASE_URL` in frontend to point to your Railway backend URL

### Option 4: Docker Deployment
```bash
cd backend
docker build -t ethsphere-backend .
docker run -p 3001:3001 --env-file .env ethsphere-backend
```

## 🔧 Environment Variables

### Backend (.env)
```bash
# Required
INFURA_API_KEY=your_infura_api_key_here
ENCRYPTION_KEY=your_strong_encryption_key_here_at_least_32_chars

# Optional
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://www.your-frontend-domain.com
```

### Frontend (.env)
```bash
VITE_API_BASE_URL=https://your-backend-domain.com
VITE_APP_TITLE=Ethsphere - Ethereum Transaction Visualizer
```

## 🔐 AI Provider Setup

The application supports multiple AI providers for natural language SQL queries:
- **OpenAI**: Enhanced security with server-side key validation
- **Groq**: Fast inference for SQL generation
- **Claude**: High-quality natural language understanding
- **Gemini**: Google's language model

Connect any provider through the in-app setup panel.

## 🏗️ Architecture

- **Backend**: Node.js + Express + DuckDB + Ethers.js
- **Frontend**: React + Three.js + Vite
- **Database**: DuckDB for fast analytics on transaction data
- **Blockchain**: Real-time Ethereum transaction streaming via Infura

## 📊 Features

- **Real-time 3D Visualization**: Interactive sphere showing Ethereum addresses and transaction flows
- **Natural Language SQL**: Ask questions in plain English, get SQL results
- **Multi-Provider AI**: Connect OpenAI, Groq, Claude, or Gemini for smart queries
- **Transaction Analytics**: Comprehensive statistics and custom queries
- **Secure Authentication**: Server-side API key encryption and validation
- **Responsive Design**: Works on desktop and mobile devices

## 🛠️ Development

Built with modern security practices:
- Non-root Docker containers
- SQL injection protection
- Encrypted API key storage
- CORS configuration
- Health check endpoints

## 📝 License

This project is open source. See the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines first.