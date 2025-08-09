# Deployment Guide

## Railway Deployment (Recommended)

Railway is the easiest way to deploy the full Ethsphere application.

### Step 1: Prepare Repository
1. Ensure your code is pushed to GitHub
2. Make sure you have the required environment variables set

### Step 2: Deploy Backend
1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository and choose the `backend` folder
4. Railway will automatically detect the `deploy/railway.json` configuration
5. Set environment variables in Railway dashboard:
   ```
   INFURA_API_KEY=your_infura_api_key
   ENCRYPTION_KEY=generate_32_char_random_string
   NODE_ENV=production
   PORT=3001
   ```
6. Deploy and note your backend URL (e.g., `https://your-app.railway.app`)

### Step 3: Deploy Frontend
1. Create another Railway service for the frontend
2. Connect the same repository, choose `frontend` folder
3. Set environment variables:
   ```
   VITE_API_BASE_URL=https://your-backend-url.railway.app
   ```
4. Deploy and get your frontend URL

### Step 4: Update CORS Settings
1. Go back to your backend service in Railway
2. Add these environment variables:
   ```
   FRONTEND_URL=https://your-frontend-url.railway.app
   ALLOWED_ORIGINS=https://your-frontend-url.railway.app
   ```
3. Redeploy backend

## Vercel + Railway Deployment

For optimal performance, use Vercel for the frontend and Railway for the backend.

### Backend on Railway
Follow the backend steps from above.

### Frontend on Vercel
1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "New Project" and import your repository
3. Select the `frontend` folder as root directory
4. Set environment variables:
   ```
   VITE_API_BASE_URL=https://your-railway-backend.railway.app
   ```
5. Deploy

## Render Deployment

### Backend
1. Go to [render.com](https://render.com)
2. Create a new Web Service from your repository
3. Use these settings:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Set environment variables as listed above

### Frontend
1. Create a Static Site service
2. Use these settings:
   - Root Directory: `frontend`
   - Build Command: `npm run build:prod`
   - Publish Directory: `dist`

## Docker Deployment

### Backend
```bash
cd backend
docker build -t ethsphere-backend .
docker run -p 3001:3001 --env-file .env ethsphere-backend
```

### Frontend
```bash
cd frontend
npm run build:prod
# Serve the dist folder with any static file server
```

## Environment Variables Reference

### Required Backend Variables
- `INFURA_API_KEY`: Your Infura API key for Ethereum access
- `ENCRYPTION_KEY`: 32+ character string for encrypting stored API keys

### Optional Backend Variables
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment (development/production)
- `FRONTEND_URL`: Your frontend URL for CORS
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins

### Frontend Variables
- `VITE_API_BASE_URL`: Your backend API URL
- `VITE_APP_TITLE`: Application title

## Troubleshooting

### CORS Issues
Make sure `ALLOWED_ORIGINS` in your backend includes your frontend URL.

### API Connection Issues
Verify `VITE_API_BASE_URL` in frontend matches your backend deployment URL.

### Database Issues
DuckDB will automatically create the database file. Ensure the deployment platform provides persistent storage.

### AI Provider Issues
Each AI provider (OpenAI, Groq, etc.) must be configured through the app UI after deployment.