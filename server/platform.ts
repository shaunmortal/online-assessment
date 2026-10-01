import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { StateStore, isExamState, isPatch, patchOf, verifyReceipt, type ExamState, type Receipt, type StatePatch } from '../src/lib/core'
import { createProctorHandler, proctorStats } from './proctor'
import { rosterEntry } from '../src/data/paper'

// The exam server: sync relay with durable on-disk storage, health metrics, receipt signing,
// backup/restore, and Claude-backed officer co-pilot + post-exam risk report.
const MODEL = 'claude-opus-5-5'
const DATA = process.env.EXAM_DATA_DIR ?? join(process.cwd(), 'data') // separate dir per server instance
const STATE_FILE = join(DATA, 'state.json')
const EVIDENCE_FILE = join(DATA, 'evidence.ndjson')
const KEY_FILE = join(DATA, 'signing-key.json')
const MAX_BODY = 2_000_000

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new Error('Body too large'))
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

// ---------- signing key (ECDSA P-256, persisted so receipts stay verifiable across restarts)

function loadKey(): { privateKey: KeyObject; publicJwk: Record<string, unknown>; keyId: string } {
  mkdirSync(DATA, { recursive: true })
  let privateKey: KeyObject
  if (existsSync(KEY_FILE)) {
    privateKey = createPrivateKey({ key: JSON.parse(readFileSync(KEY_FILE, 'utf8')), format: 'jwk' })
  } else {
    privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    writeFileSync(KEY_FILE, JSON.stringify(privateKey.export({ format: 'jwk' })), { mode: 0o600 })
  }
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' }) as Record<string, unknown>
  const keyId = createHash('sha256').update(JSON.stringify([publicJwk.x, publicJwk.y])).digest('hex').slice(0, 16).toUpperCase()
  return { privateKey, publicJwk, keyId }
}

// ---------- Claude co-pilot schemas

const CopilotAdvice = z.object({
  assessment: z.string().describe('2-3 sentences: what most likely happened, based only on the evidence given'),
  recommendation: z.enum(['recover', 'protect-time', 'reschedule', 'needs-human-review']),
  confidence: z.enum(['low', 'medium', 'high']),
  key_evidence: z.array(z.string()).describe('Up to 5 short facts from the evidence that drive the recommendation'),
  cautions: z.array(z.string()).describe('What the officer should double-check before deciding; empty if none'),
})

const RiskReport = z.object({
  headline: z.string().describe('One sentence summary of the exam session reliability'),
  root_causes: z.array(z.object({ cause: z.string(), evidence: z.string(), affected: z.string() })),
  risks: z.array(z.object({ area: z.string(), severity: z.enum(['low', 'medium', 'high']), why: z.string() })),
  recommendations: z.array(z.object({ action: z.string(), priority: z.enum(['now', 'before-next-exam', 'later']), expected_effect: z.string() })),
})

const COPILOT_SYSTEM = `You are a decision-support assistant for an exam officer handling a disrupted online exam.
You only see structured evidence (heartbeat intervals, offline answers, integrity signals, candidate confirmations).
Recommend the smallest fair remedy the evidence supports: recover (resume, nothing to restore), protect-time (add time),
reschedule (targeted re-exam for the affected candidate(s) only), or needs-human-review if the evidence conflicts.
Never recommend changing marks or punishing a candidate. Be concise and factual; the officer decides.`

const REPORT_SYSTEM = `You are an exam-reliability analyst. You receive aggregated, anonymised metrics from one exam session:
per centre/service path heartbeat losses, offline minutes, incidents, remedies, device telemetry and integrity-signal counts.
Identify likely systemic root causes, rank risks, and give concrete prevention steps for the next exam.
Ground every statement in the numbers given; say "insufficient data" rather than guessing.`

export function attachPlatform(httpServer: Server | null | undefined, use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void, apiKey: string | undefined, intervalSeconds: number) {
  const startedAt = Date.now()
  const key = loadKey()
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }) : undefined

  // Durable state: load the last merged session from disk so a server restart needs no browser.
  const store = new StateStore()
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (isExamState(saved)) store.apply(patchOf(saved))
  } catch {
    // first run
  }
  const logged = new Set<string>()
  try {
    for (const line of readFileSync(EVIDENCE_FILE, 'utf8').split('\n')) if (line) logged.add(JSON.parse(line).id)
  } catch {
    // no log yet
  }
  let lastPersistAt: string | undefined
  let persistError: string | undefined
  let persistTimer: NodeJS.Timeout | undefined
  // Throttled (not debounced): under constant traffic a debounce would never fire.
  const persist = () => {
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      const latest = store.state
      if (!latest) return
      try {
        mkdirSync(DATA, { recursive: true })
        writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(latest))
        renameSync(`${STATE_FILE}.tmp`, STATE_FILE) // atomic replace
        // Append-only evidence log: every sealed event is written once, in arrival order.
        const fresh = latest.audit.filter((event) => event.digest && !logged.has(event.id))
        if (fresh.length) {
          appendFileSync(EVIDENCE_FILE, fresh.map((event) => JSON.stringify({ ...event, session: store.state!.sessionId, receivedAt: new Date().toISOString() })).join('\n') + '\n')
          fresh.forEach((event) => logged.add(event.id))
        }
        lastPersistAt = new Date().toISOString()
        persistError = undefined
      } catch (error) {
        persistError = error instanceof Error ? error.message : 'write failed'
      }
    }, 1500) // full snapshot at most every 1.5 s; large halls make this the main CPU cost
  }

  // Event-loop lag: how late a 500 ms timer fires (server overload indicator).
  let loopLagMs = 0
  let expected = Date.now() + 500
  const lagTimer = setInterval(() => {
    loopLagMs = Math.max(0, Date.now() - expected)
    expected = Date.now() + 500
  }, 500)
  lagTimer.unref()

  let messages: number[] = []
  let bytesIn = 0
  let bytesOut = 0
  const relay = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  // Routing: a candidate PC only needs control updates and its own data; the Control Tower and
  // viewers get everything. Candidate traffic therefore fans out to a handful of officers, not to N PCs.
  const meta = new WeakMap<WebSocket, { role: string; me?: string }>()
  const forClient = (patch: StatePatch, ws: WebSocket): StatePatch | null => {
    const info = meta.get(ws)
    if (!info || info.role !== 'candidate') return patch
    const me = info.me
    const out: StatePatch = { sessionId: patch.sessionId, createdAt: patch.createdAt, epoch: patch.epoch, full: patch.full }
    let useful = Boolean(patch.full)
    if (patch.control) { out.control = patch.control; useful = true }
    if (me && patch.candidates?.[me]) { out.candidates = { [me]: patch.candidates[me] }; useful = true }
    const events = patch.audit?.filter((event) => !event.candidateId || event.candidateId === me)
    if (events?.length) { out.audit = events; useful = true }
    const own = patch.checkpoints?.filter((checkpoint) => checkpoint.candidateId === me)
    if (own?.length) { out.checkpoints = own; useful = true }
    return useful ? out : null
  }
  const sendTo = (ws: WebSocket, patch: StatePatch, source: string) => {
    const filtered = forClient(patch, ws)
    if (!filtered || ws.readyState !== WebSocket.OPEN) return
    const message = JSON.stringify({ source, patch: filtered })
    bytesOut += message.length
    ws.send(message)
  }
  // Index sockets by role so a candidate's update costs O(officers + that candidate's devices), not O(all PCs).
  const officers = new Set<WebSocket>()
  const byCandidate = new Map<string, Set<WebSocket>>()
  const register = (ws: WebSocket, role: string, me?: string) => {
    const old = meta.get(ws)
    if (old?.me) byCandidate.get(old.me)?.delete(ws)
    officers.delete(ws)
    meta.set(ws, { role, me })
    if (role === 'candidate') {
      if (me) byCandidate.set(me, (byCandidate.get(me) ?? new Set()).add(ws))
    } else officers.add(ws)
  }
  const unregister = (ws: WebSocket) => {
    const info = meta.get(ws)
    if (info?.me) byCandidate.get(info.me)?.delete(ws)
    officers.delete(ws)
  }
  const broadcast = (patch: StatePatch, source = 'relay', except?: WebSocket) => {
    // Control changes and full snapshots concern every PC; everything else only the officers and the owner.
    if (patch.full || patch.control) {
      for (const peer of relay.clients) if (peer !== except) sendTo(peer, patch, source)
      return
    }
    for (const peer of officers) if (peer !== except) sendTo(peer, patch, source)
    const owners = new Set<string>([...Object.keys(patch.candidates ?? {}), ...(patch.audit ?? []).map((event) => event.candidateId ?? ''), ...(patch.checkpoints ?? []).map((checkpoint) => checkpoint.candidateId)])
    for (const id of owners) for (const peer of byCandidate.get(id) ?? []) if (peer !== except) sendTo(peer, patch, source)
  }

  if (httpServer) {
    httpServer.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/examshield-sync') return
      relay.handleUpgrade(request, socket, head, (ws) => relay.emit('connection', ws, request))
    })
    relay.on('connection', (ws: WebSocket) => {
      register(ws, 'viewer')
      ws.on('close', () => unregister(ws))
      let greeted = false
      ws.on('message', (payload) => {
        try {
          const text = payload.toString()
          bytesIn += text.length
          const envelope = JSON.parse(text) as { source?: string; role?: string; me?: string; patch?: unknown; state?: unknown }
          const previousMe = meta.get(ws)?.me
          if (envelope.role && (envelope.role !== meta.get(ws)?.role || envelope.me !== previousMe)) register(ws, envelope.role, envelope.me)
          // First message (or a newly signed-in candidate): send the current snapshot, filtered for this client.
          if (store.state && (!greeted || envelope.me !== previousMe)) sendTo(ws, patchOf(store.state), 'relay')
          greeted = true
          const patch = isPatch(envelope.patch) ? envelope.patch : isExamState(envelope.state) ? patchOf(envelope.state) : undefined
          if (!patch) return
          const before = store.state?.sessionId
          if (!store.apply(patch)) return
          messages.push(Date.now())
          // A session switch (reset/restore) goes out as a full snapshot; otherwise just the delta.
          if (store.state!.sessionId !== before) broadcast(patchOf(store.state!), envelope.source ?? 'relay')
          else broadcast(patch, envelope.source ?? 'relay', ws)
          persist()
        } catch {
          // ignore malformed frames
        }
      })
    })
    httpServer.once('close', () => relay.close())
  }

  const claude = async <T extends z.ZodType>(schema: T, system: string, context: unknown): Promise<z.infer<T>> => {
    const response = await client!.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: `Evidence (JSON):\n${JSON.stringify(context).slice(0, 60_000)}` }],
    })
    if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error('The model did not return an answer.')
    return response.parsed_output as z.infer<T>
  }

  use(createProctorHandler(apiKey, intervalSeconds))
  use(async (req, res, next) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    try {
      if (path === '/api/health' && req.method === 'GET') {
        messages = messages.filter((time) => Date.now() - time < 60_000)
        const memory = process.memoryUsage()
        return send(res, 200, {
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          eventLoopLagMs: loopLagMs,
          memoryMb: Math.round(memory.rss / 1048576),
          relayClients: relay.clients.size,
          relayMessagesPerMinute: messages.length,
          relayBytes: { in: bytesIn, out: bytesOut },
          storage: { lastPersistAt, error: persistError, evidenceEvents: logged.size, file: 'data/state.json' },
          signing: { keyId: key.keyId },
          proctor: { enabled: Boolean(client), ...proctorStats },
        })
      }
      if (path === '/api/public-key' && req.method === 'GET') return send(res, 200, { keyId: key.keyId, jwk: key.publicJwk, alg: 'ECDSA P-256 / SHA-256' })

      // The server signs a receipt only after re-verifying it against its OWN copy of the evidence.
      if (path === '/api/sign-receipt' && req.method === 'POST') {
        const { receipt } = (await readJson(req)) as { receipt?: Receipt }
        if (!receipt?.hash || !Array.isArray(receipt.eventIds)) return send(res, 400, { error: 'Expected { receipt }' })
        let problem = 'No exam session on the server yet.'
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const latest = store.state
          if (latest) {
            const check = await verifyReceipt(receipt, latest.sessionId, latest.audit)
            if (check.ok) {
              const signature = sign('sha256', Buffer.from(receipt.hash), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
              return send(res, 200, { signature, keyId: key.keyId })
            }
            problem = check.problem ?? 'Receipt does not match the server evidence store.'
          }
          await new Promise((resolve) => setTimeout(resolve, 400)) // the newest events may still be in flight on the relay
        }
        return send(res, 409, { error: problem })
      }

      // Sign-in fetches the candidate's saved attempt first, so a second PC resumes instead of restarting.
      if (path === '/api/candidate-state' && req.method === 'POST') {
        const { id, dob } = (await readJson(req)) as { id?: string; dob?: string }
        const entry = rosterEntry(String(id ?? '').trim().toUpperCase())
        if (!entry || entry.dob !== String(dob ?? '').replace(/\D/g, '')) return send(res, 403, { error: 'Invalid Candidate ID or Date of Birth.' })
        const state = store.state
        if (!state) return send(res, 200, { patch: null })
        return send(res, 200, {
          patch: {
            sessionId: state.sessionId, createdAt: state.createdAt, epoch: state.epoch, full: true, control: state.control,
            candidates: state.candidates[entry.id] ? { [entry.id]: state.candidates[entry.id] } : {},
            audit: state.audit.filter((event) => !event.candidateId || event.candidateId === entry.id),
            checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.candidateId === entry.id),
          },
        })
      }
      // Candidates only hold their own slice of the log, so they ask the server to check a receipt.
      if (path === '/api/verify-receipt' && req.method === 'POST') {
        const { receipt } = (await readJson(req)) as { receipt?: Receipt }
        if (!receipt?.hash || !Array.isArray(receipt.eventIds) || !store.state) return send(res, 400, { error: 'Expected { receipt }' })
        return send(res, 200, await verifyReceipt(receipt, store.state.sessionId, store.state.audit))
      }
      if (path === '/api/backup' && req.method === 'GET') {
        const latest = store.state
        if (!latest) return send(res, 404, { error: 'No session yet' })
        res.setHeader('Content-Disposition', `attachment; filename="examshield-backup-${latest.sessionId}.json"`)
        return send(res, 200, latest)
      }
      if (path === '/api/restore' && req.method === 'POST') {
        const incoming = await readJson(req)
        if (!isExamState(incoming)) return send(res, 400, { error: 'Not an ExamShield backup' })
        // A restore must win over whatever the browsers hold, so it gets the highest epoch.
        const restored: ExamState = { ...incoming, epoch: Math.max(incoming.epoch ?? 0, store.state?.epoch ?? 0) + 1 }
        store.state = undefined
        store.apply(patchOf(restored))
        broadcast(patchOf(restored))
        persist()
        return send(res, 200, { ok: true, sessionId: restored.sessionId, candidates: Object.keys(restored.candidates).length, events: restored.audit.length })
      }

      if ((path === '/api/copilot' || path === '/api/risk-report') && req.method === 'POST') {
        if (!client) return send(res, 503, { error: 'AI is off: set ANTHROPIC_API_KEY in .env and restart.' })
        const { context } = (await readJson(req)) as { context?: unknown }
        if (!context) return send(res, 400, { error: 'Expected { context }' })
        const started = Date.now()
        const result = path === '/api/copilot' ? await claude(CopilotAdvice, COPILOT_SYSTEM, context) : await claude(RiskReport, REPORT_SYSTEM, context)
        return send(res, 200, { result, model: MODEL, ms: Date.now() - started, at: new Date().toISOString() })
      }
    } catch (error) {
      if (error instanceof Anthropic.APIError) return send(res, 502, { error: `Claude API error ${error.status ?? ''}`.trim() })
      return send(res, 500, { error: error instanceof Error ? error.message : 'Server error' })
    }
    return next()
  })
}
