import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// `WEB_PORT` / `API_PORT` let a second checkout (e.g. this one next to
// fishDict) run without fighting over the default 5173 / 8787.
const API = `http://localhost:${process.env.API_PORT ?? '8787'}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': API,
      // Pronunciation audio is served by the Hono API out of $AUDIO_DIR.
      '/audio': API,
    },
  },
})
