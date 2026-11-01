import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths so the app works under a GitHub Pages project path.
  base: './',
  plugins: [react()],
})
