// Frontend configuration
const config = {
  // Use environment variable or fallback to localhost for development
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001',
  APP_TITLE: import.meta.env.VITE_APP_TITLE || 'Ethsphere - Ethereum Transaction Visualizer'
};

export default config;