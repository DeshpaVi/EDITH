import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: {
    // The agent workspace loads this in an iframe with no source map server.
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5273'),
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5273'),
  },
})
