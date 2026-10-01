// Self-check: signed manifest verifies, decrypted questions match their hashes, the tamper drill is
// caught, keys are time-locked to the exam window, and the answer key needs the officer passcode.
import assert from 'node:assert/strict'
import { createDecipheriv, createHash, generateKeyPairSync, verify } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createState } from '../src/lib/core.ts'
import { createPaperHandler } from './paperService.ts'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
let state = createState()
const handler = createPaperHandler({
  privateKey, keyId: 'TEST', getState: () => state,
  officerOk: (req) => req.headers['x-officer-passcode'] === 'pw',
  readJson: async (req) => (req as unknown as { body: unknown }).body,
  send: (res, status, body) => Object.assign(res, { status, body }),
})
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = {} as ServerResponse & { status: number; body: any }
  await handler({ method, url, body, headers } as unknown as IncomingMessage, res, url.split('?')[0])
  return res
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex').toUpperCase()
const open = (key: string, iv: string, ciphertext: string) => {
  const data = Buffer.from(ciphertext, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(data.subarray(-16))
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString()) as Array<{ id: string; key?: number }>
}

const paper = (await call('GET', '/api/paper?id=EXM-20891')).body
assert.ok(verify('sha256', Buffer.from(paper.manifest), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(paper.signature, 'base64')))
const manifest = JSON.parse(paper.manifest)
const key = (await call('POST', '/api/paper-key', { id: 'EXM-20891', dob: '19092003' })).body.key
const questions = open(key, paper.iv, paper.ciphertext)
assert.equal(questions.length, 27)
assert.ok(questions.every((q, i) => sha(JSON.stringify(q)) === manifest.items[i].hash))
assert.ok(questions.every((q) => q.key === undefined)) // no answer keys leave the server

state = { ...state, control: { ...state.control, paperTamper: 'sync-c' } }
const bad = (await call('GET', '/api/paper?id=EXM-20891')).body
const altered = open(key, bad.iv, bad.ciphertext).filter((q, i) => sha(JSON.stringify(q)) !== manifest.items[i].hash).map((q) => q.id)
assert.deepEqual(altered, ['T5'])
const other = (await call('GET', '/api/paper?id=EXM-20841')).body // Pune path is unaffected
assert.ok(open(key, other.iv, other.ciphertext).every((q, i) => sha(JSON.stringify(q)) === manifest.items[i].hash))

assert.equal((await call('POST', '/api/paper-key', { id: 'EXM-20891', dob: '01010101' })).status, 403)
state = { ...state, createdAt: new Date(Date.now() + 60_000).toISOString() }
assert.equal((await call('POST', '/api/paper-key', { id: 'EXM-20891', dob: '19092003' })).status, 423) // window not open yet
state = { ...state, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() }
assert.equal((await call('POST', '/api/paper-key', { id: 'EXM-20891', dob: '19092003' })).status, 423) // window closed

assert.equal((await call('GET', '/api/answer-key')).status, 401)
assert.equal((await call('GET', '/api/answer-key', undefined, { 'x-officer-passcode': 'pw' })).body.keys.T5, 'B')
console.log('paper service self-check passed')
