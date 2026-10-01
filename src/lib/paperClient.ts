// Candidate-side paper loading: download the encrypted paper, check the authority signature on its
// manifest, fetch the time-locked key, decrypt, and compare every question with its signed hash
// before anything is shown. Then shuffle per candidate (question order within sections, MCQ options).
import { sha256 } from './core'
import type { Question } from '../data/paper'

// This tab's paper in this candidate's order. Empty until a verified paper is loaded.
export const QUESTIONS: Question[] = []
export const questionById = (id: string) => QUESTIONS.find((q) => q.id === id) ?? QUESTIONS[0]
export let paperInfo: { root: string; version: string; code: string; keyId: string } | null = null

let publicKey: Promise<{ key: CryptoKey; keyId: string } | null> | undefined
export const serverKey = () => (publicKey ??= fetch('/api/public-key')
  .then((response) => response.json())
  .then(async (body) => ({ keyId: body.keyId as string, key: await crypto.subtle.importKey('jwk', body.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) }))
  .catch(() => { publicKey = undefined; return null }))

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

export type PaperResult =
  | { ok: true; root: string; count: number; code: string; version: string; cached: boolean }
  | { ok: false; reason: string; tampered?: string[]; locked?: boolean }

interface Manifest { paper: { code: string; version: string }; items: Array<{ id: string; hash: string }>; root: string; keyId: string }
interface Cached { manifest: string; signature: string; keyId: string; questions: Question[] }

// Signature + per-question hashes. Used for fresh downloads and for the offline copy alike.
async function verify(manifestText: string, signature: string, keyId: string, questions: Question[]): Promise<PaperResult> {
  const server = await serverKey()
  if (!server) return { ok: false, reason: 'Could not fetch the exam authority public key.' }
  if (server.keyId !== keyId) return { ok: false, reason: `Paper signed by unknown key ${keyId}.` }
  const signed = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, server.key, bytes(signature), new TextEncoder().encode(manifestText))
  if (!signed) return { ok: false, reason: 'Paper manifest signature is INVALID — the manifest was altered.', tampered: ['manifest'] }
  const manifest = JSON.parse(manifestText) as Manifest
  const byId = new Map(questions.map((q) => [q.id, q]))
  const tampered: string[] = []
  for (const item of manifest.items) {
    const question = byId.get(item.id)
    if (!question || (await sha256(JSON.stringify(question))) !== item.hash) tampered.push(item.id)
  }
  if (questions.length !== manifest.items.length) tampered.push('extra items')
  if (tampered.length) return { ok: false, reason: `PAPER TAMPERED: ${tampered.join(', ')} ${tampered.length === 1 ? 'does' : 'do'} not match the authority-signed paper.`, tampered }
  return { ok: true, root: manifest.root, count: questions.length, code: manifest.paper.code, version: manifest.paper.version, cached: false }
}

// Deterministic per candidate + session: neighbours see different question numbers and option letters.
function shuffled(questions: Question[], seedText: string) {
  let seed = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const shuffle = <T,>(list: T[]) => { const out = [...list]; for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] } return out }
  const sections = [...new Set(questions.map((q) => q.section))]
  return sections.flatMap((section) => shuffle(questions.filter((q) => q.section === section)).map((q) => {
    if (q.type !== 'mcq') return q
    // "None of these" stays last; everything else is shuffled. order[display] = canonical option index.
    const fixed = q.text.en.options.map((o, i) => (/^none of/i.test(o) ? i : -1)).filter((i) => i >= 0)
    const order = [...shuffle(q.text.en.options.map((_, i) => i).filter((i) => !fixed.includes(i))), ...fixed]
    return { ...q, order }
  }))
}

function install(questions: Question[], result: Extract<PaperResult, { ok: true }>, keyId: string, seed: string) {
  QUESTIONS.splice(0, QUESTIONS.length, ...shuffled(questions, seed))
  paperInfo = { root: result.root, version: result.version, code: result.code, keyId }
}

export async function loadPaper(candidateId: string, dob: string, sessionId: string): Promise<PaperResult> {
  const cacheKey = `examshield:paper:${sessionId}:${candidateId}`
  const seed = `${sessionId}:${candidateId}`
  let download: { manifest: string; signature: string; keyId: string; iv: string; ciphertext: string }
  let key: { key?: string; error?: string }
  let status = 0
  try {
    download = await (await fetch(`/api/paper?id=${encodeURIComponent(candidateId)}`, { cache: 'no-store' })).json()
    const response = await fetch('/api/paper-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: candidateId, dob }) })
    status = response.status
    key = await response.json()
  } catch {
    // Offline: a paper already verified on this PC for this session is re-verified and reused.
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey) ?? 'null') as Cached | null
      if (!cached) return { ok: false, reason: 'Cannot reach the exam server to download the paper.' }
      const result = await verify(cached.manifest, cached.signature, cached.keyId, cached.questions)
      if (result.ok) install(cached.questions, result, cached.keyId, seed)
      return result.ok ? { ...result, cached: true } : result
    } catch {
      return { ok: false, reason: 'Cannot reach the exam server to download the paper.' }
    }
  }
  if (!key.key) return { ok: false, reason: key.error ?? `Paper key refused (HTTP ${status}).`, locked: status === 423 }
  let questions: Question[]
  try {
    const aes = await crypto.subtle.importKey('raw', bytes(key.key), 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(download.iv) }, aes, bytes(download.ciphertext))
    questions = JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return { ok: false, reason: 'Paper could not be decrypted (wrong key or corrupted download).', tampered: ['ciphertext'] }
  }
  const result = await verify(download.manifest, download.signature, download.keyId, questions)
  if (!result.ok) return result
  install(questions, result, download.keyId, seed)
  try { window.localStorage.setItem(cacheKey, JSON.stringify({ manifest: download.manifest, signature: download.signature, keyId: download.keyId, questions } satisfies Cached)) } catch { /* storage full: online-only */ }
  return result
}
