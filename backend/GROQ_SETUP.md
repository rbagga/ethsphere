# Groq LLM Integration Setup

This application now supports real LLM-powered natural language to SQL conversion using Groq's free API.

## 🚀 Quick Setup

### 1. Get Your Free Groq API Key
1. Go to [console.groq.com](https://console.groq.com)
2. Sign up for a free account
3. Navigate to API Keys section
4. Create a new API key

### 2. Configure Your Environment
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Add your Groq API key to `.env`:
   ```bash
   # Add this line to your .env file
   GROQ_API_KEY=gsk_your_actual_groq_api_key_here
   ```

### 3. Restart Your Server
```bash
npm start
```

## ✅ That's it! 

The application will now use Groq's Llama 3.1 70B model for natural language to SQL conversion.

## 🆓 Groq Free Tier Limits
- **6,000 tokens per minute**
- **30 requests per minute** 
- **Unlimited monthly usage**

Perfect for development and moderate usage!

## 🔄 Fallback System

If Groq API is unavailable or you don't have an API key, the system automatically falls back to the rule-based converter. You'll see indicators in the UI:

- **🤖 AI-generated**: Query converted using Groq LLM
- **📋 Rule-based**: Query converted using simple rules

## 🎯 Model Used: `llama-3.1-70b-versatile`

This model is:
- ✅ **Fast**: ~800 tokens/second  
- ✅ **Capable**: 70B parameters
- ✅ **Free**: Within generous limits
- ✅ **SQL-optimized**: Great for code generation

## 🔧 Advanced Configuration

You can modify the Groq settings in `src/routes.js`:

```javascript
model: 'llama-3.1-70b-versatile', // Try other models
temperature: 0.1, // Lower = more consistent SQL
max_tokens: 500, // Adjust for complex queries
```

Available models:
- `llama-3.1-70b-versatile` (recommended)
- `llama-3.1-8b-instant` (faster, less capable)
- `mixtral-8x7b-32768` (alternative option)

## 🐛 Troubleshooting

**No API Key Error**: Make sure `GROQ_API_KEY` is set in your `.env` file

**Rate Limit Error**: You've hit the free tier limits. Wait a moment and try again.

**Fallback Mode**: If you see "📋 Rule-based", the Groq API call failed and fell back to simple rules.

**Invalid SQL**: The LLM occasionally generates invalid SQL. The system validates that queries start with `SELECT` for security.

## 🎉 Enjoy AI-Powered SQL Generation!

You can now ask questions like:
- "Show me transactions with values greater than 1 ETH"
- "Find the most expensive transactions this week"  
- "Which addresses sent the most transactions to Uniswap?"

The LLM will generate sophisticated SQL queries that the rule-based system couldn't handle!