import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` is the repo name so assets resolve correctly on GitHub Pages
// (https://<user>.github.io/GDPProject/). The app uses HashRouter, so
// client-side routing works on Pages without extra 404 handling.
export default defineConfig({
  base: '/GDPProject/',
  plugins: [react()],
  test: {
    // Scoped to src/: without this the default glob also picks up the Expo
    // app's tests under mobile/, running them twice and in the wrong env.
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
})
