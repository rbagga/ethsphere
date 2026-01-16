// Frontend configuration
const explicitApi = import.meta.env.VITE_API_BASE_URL;

let resolvedApi = explicitApi;
if (!resolvedApi && typeof window !== 'undefined') {
  const host = window.location.hostname;
  if (host.endsWith('vercel.app')) {
    // Default to production backend when deployed on Vercel
    resolvedApi = 'https://ethsphere-production.up.railway.app';
  } else if (host === 'localhost' || host === '127.0.0.1') {
    resolvedApi = 'http://localhost:3001';
  } else {
    // Safe fallback to production backend for other hosts
    resolvedApi = 'https://ethsphere-production.up.railway.app';
  }
}

const config = {
  API_BASE_URL: resolvedApi || 'http://localhost:3001',
  APP_TITLE: import.meta.env.VITE_APP_TITLE || 'Ethsphere - Ethereum Transaction Visualizer'
};

export default config;
