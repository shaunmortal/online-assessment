import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ROSTER } from '../src/data/paper'

// AI proctor: the browser posts one downscaled webcam JPEG, Claude returns a
// structured observation. The API key stays on this server process.
const MODEL = 'claude-opus-5-5'

export const ProctorVerdict = z.object({
  faces_visible: z.number().int().describe('Number of distinct human faces or heads visible anywhere in the frame, including background and partly visible ones'),
  candidate_present: z.boolean().describe('A person is seated in front of the camera'),
  looking_away: z.boolean().describe('The main person is clearly looking away from the screen'),
  phone_or_device_visible: z.boolean().describe('A phone, earbuds, second screen or similar device is visible'),
  another_person_visible: z.boolean().describe('Someone other than the main person is visible'),
  camera_obstructed: z.boolean().describe('The camera is covered, pointed away, or too dark to see'),
  risk: z.enum(['none', 'low', 'medium', 'high']).describe('Overall need for a human proctor to review this frame'),
  summary: z.string().describe('One neutral sentence describing what is visible'),
})

export type ProctorVerdict = z.infer<typeof ProctorVerdict>

const SYSTEM = `You assist a human exam proctor by describing a single webcam frame from an online exam.
Count EVERY human face or head you can see, including people in the background, partly visible, turned sideways, small, blurred, or reflected in a screen or mirror. A second person anywhere in the frame matters.
Look carefully for phones (held, on the desk, partly hidden), earbuds/headphones, smartwatches, second screens, books or notes, and someone passing items or pointing at the screen.
Report only what is visibly present. Do not identify who anyone is, do not guess age, gender, ethnicity or emotion, and never accuse anyone of cheating; your output is a review-only signal and a human officer decides.
Risk: "none" = one person facing the screen, nothing unusual; "low" = brief look away or poor lighting; "medium" = nobody visible, camera blocked, or a device/notes visible; "high" = more than one person, or someone or something assisting.`

const MAX_BODY = 600_000
const MIN_GAP_MS = 4000
const GLOBAL_PER_MINUTE = 60 // cost guard across all candidates
const KNOWN = new Set(ROSTER.map((entry) => entry.id))
const lastCall = new Map<string, number>() // bounded by the roster size
let recentCalls: number[] = []
let lastError: string | undefined
export const proctorStats = { calls: 0, errors: 0, totalMs: 0, lastError: undefined as string | undefined }

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) tooLarge = true // keep draining so a proper 413 can be sent
      else chunks.push(chunk)
    })
    req.on('end', () => (tooLarge ? reject(new TooLarge('Frame too large (max 600 KB)')) : resolve(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export function createProctorHandler(apiKey: string | undefined, intervalSeconds: number) {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }) : undefined

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/api/heartbeat') return send(res, 200, { ok: true, at: new Date().toISOString() })
    if (path === '/api/proctor/status' && req.method === 'GET') {
      return send(res, 200, { enabled: Boolean(client), model: MODEL, intervalSeconds, lastError })
    }
    if (path !== '/api/proctor' || req.method !== 'POST') return next()
    if (!client) return send(res, 503, { error: 'AI proctoring is off: set ANTHROPIC_API_KEY in .env and restart the server.' })

    let body: { image?: unknown; candidateId?: unknown; reason?: unknown }
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      return send(res, error instanceof TooLarge ? 413 : 400, { error: error instanceof Error ? error.message : 'Invalid request body' })
    }
    const image = typeof body.image === 'string' ? body.image.replace(/^data:image\/jpeg;base64,/, '') : ''
    const candidateId = typeof body.candidateId === 'string' && KNOWN.has(body.candidateId) ? body.candidateId : ''
    if (!candidateId || !image || !/^[A-Za-z0-9+/=]+$/.test(image)) return send(res, 400, { error: 'Expected { candidateId, image: base64 JPEG }' })

    const previous = lastCall.get(candidateId) ?? 0
    if (Date.now() - previous < MIN_GAP_MS) return send(res, 429, { error: 'Too many frames; slow down.' })
    recentCalls = recentCalls.filter((time) => Date.now() - time < 60_000)
    if (recentCalls.length >= GLOBAL_PER_MINUTE) return send(res, 429, { error: 'AI proctor capacity reached; frame skipped.' })
    lastCall.set(candidateId, Date.now())
    recentCalls.push(Date.now())

    const started = Date.now()
    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(ProctorVerdict) },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
              { type: 'text', text: 'Describe this exam webcam frame. Count every face, including background ones, and list any devices.' },
            ],
          },
        ],
      })
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        return send(res, 502, { error: 'The model did not return an observation for this frame.' })
      }
      lastError = undefined
      proctorStats.calls += 1
      proctorStats.totalMs += Date.now() - started
      return send(res, 200, { verdict: response.parsed_output, model: response.model, ms: Date.now() - started })
    } catch (error) {
      lastCall.delete(candidateId) // a failed call should not block the next retry
      lastError = error instanceof Anthropic.APIError ? `Claude API error ${error.status ?? ''}`.trim() : 'Could not reach the Claude API'
      proctorStats.errors += 1
      proctorStats.lastError = lastError
      if (error instanceof Anthropic.AuthenticationError) return send(res, 502, { error: 'ANTHROPIC_API_KEY was rejected. Check the key in .env.' })
      if (error instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Claude API rate limit reached; will retry.' })
      if (error instanceof Anthropic.BadRequestError) return send(res, 502, { error: `Claude API rejected the request: ${error.message}` })
      if (error instanceof Anthropic.APIError) return send(res, 502, { error: `Claude API error ${error.status ?? ''}`.trim() })
      return send(res, 502, { error: 'Could not reach the Claude API.' })
    }
  }
}
