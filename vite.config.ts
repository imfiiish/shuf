import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      // Pronunciation audio is served by the Hono API out of $AUDIO_DIR.
      '/audio': 'http://localhost:8787',
    },
  },
})
