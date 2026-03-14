/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    alias: {
      'aws-amplify/data': path.resolve(__dirname, './src/__mocks__/aws-amplify-data.ts'),
      'aws-amplify/api': path.resolve(__dirname, './src/__mocks__/aws-amplify-api.ts'),
    },
  },
})
