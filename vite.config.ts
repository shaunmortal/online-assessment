import { defineConfig, loadEnv } from 'vite'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { attachPlatform, type PlatformOptions } from './server/platform'

function examShieldServer(options: PlatformOptions): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) =>
    attachPlatform(server.httpServer as unknown as import('node:http').Server | null, (handler) => server.middlewares.use(handler), options)
  return { name: 'examshield-server', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Other PCs on the LAN only get camera access over HTTPS, so `npm run dev:lan` serves a self-signed cert.
  const https = env.EXAM_HTTPS === '1'
  return {
    plugins: [react(), examShieldServer({ apiKey: env.ANTHROPIC_API_KEY || undefined, intervalSeconds: Number(env.PROCTOR_INTERVAL_SECONDS) || 20, officerPasscode: env.OFFICER_PASSCODE || undefined, aiDailyLimit: Number(env.AI_DAILY_LIMIT) || undefined }), ...(https ? [basicSsl()] : [])],
    server: { host: '0.0.0.0', port: 5190, strictPort: true },
    preview: { host: '0.0.0.0', port: 5190, allowedHosts: true }, // the hosting platform's domain must be accepted
  }
})
