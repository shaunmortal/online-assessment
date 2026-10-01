import { defineConfig, loadEnv } from 'vite'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { attachPlatform } from './server/platform'

function examShieldServer(apiKey: string | undefined, intervalSeconds: number): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) =>
    attachPlatform(server.httpServer as unknown as import('node:http').Server | null, (handler) => server.middlewares.use(handler), apiKey, intervalSeconds)
  return { name: 'examshield-server', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Other PCs on the LAN only get camera access over HTTPS, so `npm run dev:lan` serves a self-signed cert.
  const https = env.EXAM_HTTPS === '1'
  return {
    plugins: [react(), examShieldServer(env.ANTHROPIC_API_KEY || undefined, Number(env.PROCTOR_INTERVAL_SECONDS) || 30), ...(https ? [basicSsl()] : [])],
    server: { host: '0.0.0.0', port: 5190, strictPort: true },
    preview: { host: '0.0.0.0', port: 5190 },
  }
})
