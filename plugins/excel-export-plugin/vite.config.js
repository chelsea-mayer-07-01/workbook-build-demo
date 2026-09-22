import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const serverPort = env.PLUGIN_SERVER_PORT || 8787
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': `http://localhost:${serverPort}`,
      },
    },
  }
})
