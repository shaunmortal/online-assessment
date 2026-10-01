// Load test: N simulated candidate PCs on the real relay + one Control Tower observer.
// Usage: npm run loadtest -- 200,1000,2500 20   (sizes, seconds per size). Raise `ulimit -n` for >2000.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire(new URL('../package.json', import.meta.url))
const { WebSocket } = require('ws')
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DATA = mkdtempSync(join(tmpdir(), 'examshield-load-'))
const SIZES = (process.argv[2] ?? '200,1000,2500').split(',').map(Number)
const SECONDS = Number(process.argv[3] ?? 20)
const PORT = 5232, BASE = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/examshield-sync`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, EXAM_DATA_DIR: DATA, ANTHROPIC_API_KEY: '' }, stdio: 'ignore', detached: true })
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break } catch {} await sleep(500) }

const now = () => new Date().toISOString()
const session = { sessionId: `run-load-${Date.now()}`, createdAt: now(), epoch: Date.now() }
const control = { updatedAt: now(), rev: 1, faults: { saveChannelDown: false }, incidents: [], assistedApproved: {}, thresholdSeconds: 180, graceSeconds: 20, windowMinutes: 60, reexams: {} }
const open = (url) => new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.on('open', () => resolve(ws)); ws.on('error', reject) })

// Control Tower observer: measures how long a candidate update takes to reach it.
const ops = await open(WS)
let received = 0
let latencies = []
ops.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  for (const slice of Object.values(msg.patch?.candidates ?? {})) {
    if (slice.sentAt) { latencies.push(Date.now() - slice.sentAt); received += 1 }
  }
})
ops.send(JSON.stringify({ source: 'ops', role: 'ops', patch: { ...session, full: true, candidates: {}, control, audit: [], checkpoints: [] } }))
await sleep(500)

async function run(n, seconds) {
  const clients = []
  for (let i = 0; i < n; i++) {
    const id = `LOAD-${String(i).padStart(4, '0')}`
    const ws = await open(WS)
    let candidateBytes = 0
    ws.on('message', (data) => { candidateBytes += data.length })
    const slice = { candidateId: id, loggedInAt: now(), phase: 'exam', lang: 'en', current: 'A1', responses: {}, outages: [], assistedRequested: false, warnings: 0, startedAt: now(), rev: 1, updatedAt: now() }
    ws.send(JSON.stringify({ source: id, role: 'candidate', me: id, patch: { ...session, candidates: { [id]: slice } } }))
    clients.push({ ws, id, slice, seq: 0, bytes: () => candidateBytes })
  }
  received = 0
  latencies = []
  const health0 = await (await fetch(`${BASE}/api/health`)).json()
  const started = Date.now()
  let sent = 0
  const timers = clients.map((c, i) => setInterval(() => {
    sent += 1
    c.slice = { ...c.slice, rev: c.slice.rev + 1, updatedAt: now(), lastHeartbeatAt: now(), sentAt: Date.now() }
    const patch = { ...session, candidates: { [c.id]: c.slice } }
    if (c.slice.rev % 5 === 0) { // every ~10 s an answer: checkpoint + sealed-looking event
      c.seq += 1
      patch.checkpoints = [{ id: `cp-${c.id}-${c.seq}`, candidateId: c.id, question: 'A1', answer: 'B', at: now(), sequence: c.seq, status: 'verified' }]
      patch.audit = [{ id: `ev-${c.id}-${c.seq}`, at: now(), kind: 'checkpoint', title: 'Answer checkpoint', detail: 'Question A1: B', source: `Candidate app · ${c.id}`, candidateId: c.id, digest: 'X'.repeat(64) }]
    }
    c.ws.send(JSON.stringify({ source: c.id, role: 'candidate', me: c.id, patch }))
  }, 2000 + (i % 50))) // heartbeat cadence like the real client
  const lags = []
  while (Date.now() - started < seconds * 1000) { await sleep(1000); lags.push((await (await fetch(`${BASE}/api/health`)).json()).eventLoopLagMs) }
  timers.forEach(clearInterval)
  await sleep(1500)
  const health = await (await fetch(`${BASE}/api/health`)).json()
  latencies.sort((a, b) => a - b)
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0
  const expected = Math.round((seconds * 1000 / 2000) * n)
  const candidateIn = clients.reduce((sum, c) => sum + c.bytes(), 0)
  console.log(JSON.stringify({
    candidates: n,
    updatesDelivered: `${received}/${sent} sent (${Math.round(received / sent * 100)}%)`,
    serverAcceptedPerMin: health.relayMessagesPerMinute,
    latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: latencies.at(-1) },
    eventLoopLagMs: { max: Math.max(...lags), avg: Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) },
    serverMemoryMb: health.memoryMb,
    relayKBps: { in: Math.round((health.relayBytes.in - health0.relayBytes.in) / 1024 / seconds), out: Math.round((health.relayBytes.out - health0.relayBytes.out) / 1024 / seconds) },
    avgBytesPerCandidatePerSec: Math.round(candidateIn / n / seconds),
    persisted: health.storage.evidenceEvents,
  }))
  clients.forEach((c) => c.ws.close())
  await sleep(1000)
}

try {
  for (const n of SIZES) await run(n, SECONDS)
} finally {
  ops.close()
  try { process.kill(-server.pid, 'SIGKILL') } catch {}
  process.exit(0)
}
