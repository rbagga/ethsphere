import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          'audio-vendor': ['tone'],
          'eth-vendor': ['ethers']
        }
      },
      external: [],
      onwarn(warning, warn) {
        // Suppress certain warnings that don't affect functionality
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        if (warning.code === 'SOURCEMAP_ERROR') return;
        warn(warning);
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'three', 'ethers', 'tone'],
    exclude: ['@duckdb/duckdb-wasm']
  }
})
