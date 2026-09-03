import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  esbuild: { target: 'es2022' },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api/python-ast': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
