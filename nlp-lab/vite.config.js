import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_NLP_BASE || '/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8001' } },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.js', exclude: ['node_modules/**', '.venv/**', 'e2e/**'] },
})
