// Paper distribution, as exam boards do it: every centre can download the paper in advance, but only
// encrypted (AES-256-GCM). The key is released per candidate (ID + DOB) and only while the exam window
// is open. An authority-signed manifest (ECDSA P-256) carries a SHA-256 per question, so a centre PC
// detects any question that was changed between the board and the screen, even after decryption.
import { createCipheriv, createHash, randomBytes, sign, type KeyObject } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PAPER, rosterEntry, type Question } from '../src/data/paper'
import { windowEndsAt, type ExamState } from '../src/lib/core'
import { PAPER_CONTENT } from './paperContent'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex').toUpperCase() // same format as core.sha256

// What a candidate PC receives: everything except the MCQ answer keys. (Coding hidden tests are
// delivered because the code runs in the candidate's browser.)
const DELIVERED: Question[] = PAPER_CONTENT.map((question) => {
  if (question.type !== 'mcq') return question
  const { key: _key, ...rest } = question
  return rest
})

export const ANSWER_KEY: Record<string, string> = Object.fromEntries(
  PAPER_CONTENT.flatMap((q) => (q.type === 'mcq' && q.key !== undefined ? [[q.id, String.fromCharCode(65 + q.key)]] : [])),
)

// The tamper drill: a compromised centre swaps two options of T5 so a leaked key "works".
const TAMPERED: Question[] = DELIVERED.map((q) => q.id !== 'T5' || q.type !== 'mcq' ? q : {
  ...q,
  text: Object.fromEntries(Object.entries(q.text).map(([lang, t]) => [lang, { ...t, options: [t.options[1], t.options[0], ...t.options.slice(2)] }])) as typeof q.text,
})

interface Options {
  privateKey: KeyObject
  keyId: string
  getState: () => ExamState | undefined
  officerOk: (req: IncomingMessage) => boolean
  readJson: (req: IncomingMessage) => Promise<unknown>
  send: (res: ServerResponse, status: number, body: unknown) => void
}

export function createPaperHandler({ privateKey, keyId, getState, officerOk, readJson, send }: Options) {
  const items = DELIVERED.map((q) => ({ id: q.id, hash: sha256(JSON.stringify(q)) }))
  const manifest = JSON.stringify({ paper: PAPER, items, root: sha256(JSON.stringify(items)), issuedAt: new Date().toISOString(), keyId })
  const signature = sign('sha256', Buffer.from(manifest), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  // One content key per server start; the ciphertext and key always come from the same process.
  const contentKey = randomBytes(32)
  const seal = (questions: Question[]) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
    const body = Buffer.concat([cipher.update(JSON.stringify(questions)), cipher.final(), cipher.getAuthTag()])
    return { iv: iv.toString('base64'), ciphertext: body.toString('base64') }
  }
  const genuine = seal(DELIVERED)
  const tampered = seal(TAMPERED)

  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
    if (path === '/api/paper' && req.method === 'GET') {
      const entry = rosterEntry(new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? undefined)
      const hit = Boolean(entry && getState()?.control.paperTamper === entry.path)
      send(res, 200, { manifest, signature, keyId, ...(hit ? tampered : genuine) })
      return true
    }
    if (path === '/api/paper-key' && req.method === 'POST') {
      const { id, dob } = (await readJson(req)) as { id?: string; dob?: string }
      const entry = rosterEntry(String(id ?? '').trim().toUpperCase())
      if (!entry || entry.dob !== String(dob ?? '').replace(/\D/g, '')) { send(res, 403, { error: 'Invalid Candidate ID or Date of Birth.' }); return true }
      const state = getState()
      const opensAt = state ? Date.parse(state.createdAt) : Infinity
      const closesAt = state ? windowEndsAt(state) : 0
      const at = Date.now()
      if (at < opensAt || at >= closesAt) {
        send(res, 423, { error: at < opensAt ? 'The paper key is released when the exam window opens.' : 'The exam window has closed.', opensAt: state?.createdAt, closesAt: new Date(closesAt).toISOString() })
        return true
      }
      send(res, 200, { key: contentKey.toString('base64'), releasedAt: new Date(at).toISOString(), windowOpenedAt: state!.createdAt })
      return true
    }
    if (path === '/api/answer-key' && req.method === 'GET') {
      if (!officerOk(req)) send(res, 401, { error: 'Officer passcode required.' })
      else send(res, 200, { keys: ANSWER_KEY })
      return true
    }
    return false
  }
}
