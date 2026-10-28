import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 600000,
  workers: 1,
  use: { baseURL: process.env.NLP_DEPLOYED_URL || 'http://127.0.0.1:4175/GDPProject/nlp/', actionTimeout: 30000, headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: process.env.NLP_BROWSER_CHANNEL ? { channel: process.env.NLP_BROWSER_CHANNEL } : {} },
  webServer: process.env.NLP_DEPLOYED_URL ? undefined : { command: 'npm run preview:pages', url: 'http://127.0.0.1:4175/GDPProject/nlp/', reuseExistingServer: !process.env.CI },
})
