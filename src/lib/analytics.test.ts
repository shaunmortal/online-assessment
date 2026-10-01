// Run: node src/lib/analytics.test.ts
import assert from 'node:assert/strict'
import { createState, newCandidate, type Checkpoint, type ExamState } from './core.ts'
import { deviceRisk, examDecision, patternFlags, reconcile } from './analytics.ts'

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 9, 0, s)).toISOString()
const base = createState()
const slice = (id: string, extra = {}) => ({ ...newCandidate(id, 'A1'), loggedInAt: at(0), startedAt: at(1), phase: 'exam' as const, ...extra })

// Early warning: low battery + 3x latency + missed heartbeats = high risk.
const risky = deviceRisk(slice('EXM-20841', { telemetry: { at: at(100), rttMs: 900, jitterMs: 40, baselineRttMs: 60, missed: 2, battery: { level: 12, charging: false } } }), Date.parse(at(100)))
assert.equal(risky.level, 'high')
assert.ok(risky.reasons.some((r) => r.includes('battery')))
assert.equal(deviceRisk(slice('EXM-20841', { telemetry: { at: at(100), rttMs: 50, jitterMs: 5, baselineRttMs: 45, missed: 0 } }), Date.parse(at(100))).level, 'ok')

// Collusion: identical wrong answers on A1..A4 (keys: A1=C, A2=B, A3=D, A4=A).
const wrong = { A1: { answer: 'A' }, A2: { answer: 'D' }, A3: { answer: 'B' }, A4: { answer: 'C' } }
const colluding: ExamState = { ...base, candidates: { 'EXM-20841': slice('EXM-20841', { responses: wrong }), 'EXM-20854': slice('EXM-20854', { responses: wrong }), 'EXM-20873': slice('EXM-20873', { responses: { A1: { answer: 'C' } } }) } }
const KEYS = { A1: 'C', A2: 'B', A3: 'D', A4: 'A' }
const flags = patternFlags(colluding, KEYS)
assert.equal(flags.filter((f) => f.kind === 'collusion').length, 1)
assert.deepEqual(flags[0].candidates, ['EXM-20841', 'EXM-20854'])
assert.equal(flags[0].adjacent, true) // Lab A R1S1 / R1S2
assert.equal(patternFlags(colluding).filter((f) => f.kind === 'collusion').length, 0) // no key, no wrong-answer claim

// Seat-aware: 2 identical wrong answers flag neighbours, but not candidates in different centres.
const two = { A1: { answer: 'A' }, A2: { answer: 'D' } }
assert.equal(patternFlags({ ...base, candidates: { 'EXM-20841': slice('EXM-20841', { responses: two }), 'EXM-20854': slice('EXM-20854', { responses: two }) } }, KEYS).filter((f) => f.kind === 'collusion').length, 1)
assert.equal(patternFlags({ ...base, candidates: { 'EXM-20841': slice('EXM-20841', { responses: two }), 'EXM-20873': slice('EXM-20873', { responses: two }) } }, KEYS).filter((f) => f.kind === 'collusion').length, 0)

// Timing sync: neighbours give the same answers to the same questions within seconds of each other.
const same = { A1: { answer: 'C' }, A2: { answer: 'B' }, A3: { answer: 'D' } }
const tick = (id: string, q: string, answer: string, s: number, seq: number): Checkpoint => ({ id: `${id}${q}`, candidateId: id, question: q, answer, at: at(s), sequence: seq, status: 'verified' })
const synced: ExamState = { ...base, candidates: { 'EXM-20841': slice('EXM-20841', { responses: same }), 'EXM-20854': slice('EXM-20854', { responses: same }) },
  checkpoints: [tick('EXM-20841', 'A1', 'C', 100, 1), tick('EXM-20854', 'A1', 'C', 105, 1), tick('EXM-20841', 'A2', 'B', 200, 2), tick('EXM-20854', 'A2', 'B', 210, 2), tick('EXM-20841', 'A3', 'D', 300, 3), tick('EXM-20854', 'A3', 'D', 302, 3)] }
assert.equal(patternFlags(synced, KEYS).filter((f) => f.kind === 'timing-sync').length, 1)
assert.equal(patternFlags({ ...synced, checkpoints: synced.checkpoints.map((c) => c.candidateId === 'EXM-20854' ? { ...c, at: at(Date.parse(c.at) / 1000 - Date.parse(at(0)) / 1000 + 600) } : c) }, KEYS).filter((f) => f.kind === 'timing-sync').length, 0)

// Reconciliation: clean log passes; an offline answer outside any measured outage is flagged.
const cp = (seq: number, s: number, extra: Partial<Checkpoint> = {}): Checkpoint => ({ id: `c${seq}`, candidateId: 'EXM-20841', question: 'A1', answer: 'C', at: at(s), sequence: seq, status: 'verified', ...extra })
const clean: ExamState = { ...base, candidates: { 'EXM-20841': slice('EXM-20841', { responses: { A1: { answer: 'C' } }, outages: [{ from: at(20), to: at(40) }] }) }, checkpoints: [cp(1, 10), cp(2, 30, { reconciledAt: at(41) })] }
assert.ok(reconcile(clean, 'EXM-20841').ok)
const tampered: ExamState = { ...clean, checkpoints: [cp(1, 10), cp(2, 70, { reconciledAt: at(71) })] }
const result = reconcile(tampered, 'EXM-20841')
assert.equal(result.ok, false)
assert.equal(result.checks.find((c) => c.label.startsWith('Offline answers'))?.ok, false)
const gap: ExamState = { ...clean, checkpoints: [cp(1, 10), cp(3, 30)] }
assert.equal(reconcile(gap, 'EXM-20841').checks[0].ok, false)

// Exam decision: one of three materially affected -> targeted; two of three -> re-conduct cohort.
const incident = (id: string, affected: string[]) => ({ id, kind: 'candidate-network' as const, servicePath: 'sync-a', startedAt: at(10), restoredAt: at(400), affected, detected: true })
const three = { 'EXM-20841': slice('EXM-20841'), 'EXM-20854': slice('EXM-20854'), 'EXM-20873': slice('EXM-20873') }
assert.equal(examDecision({ ...base, candidates: three, control: { ...base.control, incidents: [incident('I1', ['EXM-20841'])] } }, Date.parse(at(500))).verdict, 'targeted')
assert.equal(examDecision({ ...base, candidates: three, control: { ...base.control, incidents: [incident('I1', ['EXM-20841', 'EXM-20854'])] } }, Date.parse(at(500))).verdict, 'reconduct-cohort')
assert.equal(examDecision({ ...base, candidates: three }, Date.parse(at(500))).verdict, 'no-reconduct')

console.log('analytics self-check passed')
