// Run: npm test  (Node 22.6+ strips the types natively)
import assert from 'node:assert/strict'
import { apiReachable, offlineSeconds, remainingSeconds, classifyLosses, createState, lostInterval, mergeState, newCandidate, recommend, sealEvents, sha256, receiptBody, verifyChain, verifyReceipt, type AuditEvent, type Receipt } from './core.ts'

const at = (s: number) => new Date(Date.UTC(2026, 9, 1, 9, 0, s)).toISOString()

// Correlation: one loss is individual, two on the same path within 30 s is a cohort.
assert.equal(classifyLosses([{ candidateId: 'a', path: 'sync-a', at: at(0) }]).scope, 'individual')
assert.equal(classifyLosses([{ candidateId: 'a', path: 'sync-a', at: at(0) }, { candidateId: 'b', path: 'sync-a', at: at(12) }]).scope, 'cohort')
assert.equal(classifyLosses([{ candidateId: 'a', path: 'sync-a', at: at(0) }, { candidateId: 'b', path: 'sync-b', at: at(1) }]).scope, 'individual')

// Remedy policy.
const base = { remainingSeconds: 1200, queuedCheckpoints: 0, thresholdSeconds: 180, graceSeconds: 20 }
assert.equal(recommend({ ...base, scope: 'individual', lostSeconds: 12 }).policy, 'recover')
assert.equal(recommend({ ...base, scope: 'individual', lostSeconds: 12 }).needsOfficer, false)
assert.equal(recommend({ ...base, scope: 'individual', lostSeconds: 60 }).policy, 'protect-time')
assert.equal(recommend({ ...base, scope: 'cohort', lostSeconds: 40 }).policy, 'protect-time')
assert.equal(recommend({ ...base, scope: 'cohort', lostSeconds: 400 }).policy, 'reschedule')
assert.equal(recommend({ ...base, scope: 'cohort', lostSeconds: 40, queuedCheckpoints: 1 }).policy, 'reschedule')

// Hash chain + receipt tamper detection.
const state = createState()
const raw: AuditEvent[] = [1, 2, 3].map((n) => ({ id: `e${n}`, at: at(n), kind: 'checkpoint', title: `cp ${n}`, detail: 'answer A', source: 'test', data: { answer: 'A' } }))
const events = await sealEvents(raw)
const chain = await verifyChain(state.sessionId, events)
assert.ok(chain.ok)
const body: Omit<Receipt, 'hash'> = {
  id: 'R1', candidateId: 'EXM-1', candidateName: 'T', incidentId: 'INC-1', interval: { from: at(0), to: at(9), seconds: 9 },
  answersPreserved: 2, checkpointsPreserved: 3, policy: 'recover', creditSeconds: 9, reason: 'r', officer: 'o', decidedAt: at(10),
  eventIds: events.map((e) => e.id), auditHead: chain.head,
}
const receipt: Receipt = { ...body, hash: await sha256(receiptBody(body)) }
assert.ok((await verifyReceipt(receipt, state.sessionId, events)).ok)
const edited = events.map((e) => (e.id === 'e2' ? { ...e, data: { answer: 'C' } } : e))
const editedCheck = await verifyReceipt(receipt, state.sessionId, edited)
assert.equal(editedCheck.ok, false)
assert.equal(editedCheck.eventsIntact, false)
// Even a forger who recomputes the digest breaks the sealed head.
const forged = await sealEvents(edited.map((e) => (e.id === 'e2' ? { ...e, digest: undefined } : e)))
const forgedCheck = await verifyReceipt(receipt, state.sessionId, forged)
assert.equal(forgedCheck.eventsIntact, true)
assert.equal(forgedCheck.chainIntact, false)
assert.equal((await verifyReceipt({ ...receipt, creditSeconds: 999 }, state.sessionId, events)).receiptIntact, false)

// Merge: slices by owner, tampered (higher rev) copy wins, new session replaces old.
const a = { ...state, audit: events }
const b = { ...state, audit: [{ ...events[1], detail: 'edited', rev: 1 }], control: { ...state.control, updatedAt: at(99), assistedApproved: { 'EXM-1': at(99) } } }
const merged = mergeState(a, b)
assert.equal(merged.audit.length, 3)
assert.equal(merged.audit[1].detail, 'edited')
assert.ok(merged.control.assistedApproved['EXM-1'])
// Two PCs: each candidate slice survives the other device's writes.
const pc1 = { ...state, candidates: { 'EXM-1': { ...newCandidate('EXM-1', 'A1'), updatedAt: at(5) } } }
const pc2 = { ...state, candidates: { 'EXM-2': { ...newCandidate('EXM-2', 'A1'), updatedAt: at(6) } } }
assert.deepEqual(Object.keys(mergeState(pc1, pc2).candidates).sort(), ['EXM-1', 'EXM-2'])
// Same-millisecond writes: the higher revision wins, not the incoming copy.
const stamp = at(7)
const older = { ...pc1, candidates: { 'EXM-1': { ...pc1.candidates['EXM-1'], updatedAt: stamp, rev: 1, current: 'A1' } } }
const newerCopy = { ...pc1, candidates: { 'EXM-1': { ...pc1.candidates['EXM-1'], updatedAt: stamp, rev: 2, current: 'A2' } } }
assert.equal(mergeState(newerCopy, older).candidates['EXM-1'].current, 'A2')
// A fresh PC (empty, newer) must adopt the running session; an explicit reset (higher epoch) replaces it.
const freshDevice = { ...createState(), createdAt: new Date(Date.now() + 1000).toISOString() }
assert.equal(mergeState(merged, freshDevice).sessionId, merged.sessionId)
assert.equal(mergeState(freshDevice, merged).sessionId, merged.sessionId)
const reset = createState((merged.epoch ?? 0) + 1)
assert.equal(mergeState(merged, reset).sessionId, reset.sessionId)
assert.equal(mergeState(reset, merged).sessionId, reset.sessionId)

// Injected incidents block the API only for affected candidates; the measured interval wins over the fault window.
const withIncident = { ...pc1, control: { ...pc1.control, incidents: [{ id: 'INC-1', kind: 'service-outage' as const, servicePath: 'sync-a', startedAt: at(10), affected: ['EXM-1'] }] } }
assert.equal(apiReachable(withIncident, 'EXM-1'), false)
assert.equal(apiReachable(withIncident, 'EXM-2'), true)
const restored = { ...withIncident, control: { ...withIncident.control, incidents: [{ ...withIncident.control.incidents[0], restoredAt: at(40) }] } }
const measured = { ...restored, candidates: { 'EXM-1': { ...restored.candidates['EXM-1'], outages: [{ from: at(9), to: at(42) }] } } }
assert.deepEqual(lostInterval(measured, measured.control.incidents[0], 'EXM-1'), { from: at(9), to: at(42) })
assert.equal(lostInterval({ ...measured, candidates: { 'EXM-1': { ...measured.candidates['EXM-1'], outages: [{ from: at(9) }] } } }, measured.control.incidents[0], 'EXM-1'), undefined)

// Timer keeps running during an outage; offline time is counted separately.
const running = { ...createState(), candidates: { 'EXM-1': { ...newCandidate('EXM-1', 'A1'), startedAt: at(0), outages: [{ from: at(100), to: at(160) }, { from: at(200) }] } } }
assert.equal(remainingSeconds(running, 'EXM-1', Date.parse(at(150))), remainingSeconds(running, 'EXM-1', Date.parse(at(100))) - 50)
assert.equal(Math.round(offlineSeconds(running.candidates['EXM-1'], Date.parse(at(230)))), 90)
assert.equal(offlineSeconds(running.candidates['EXM-1'], Date.parse(at(230)), { from: at(90), to: at(130) }), 30)

// An earlier blip that closed exactly when a new incident started is not that incident's interval.
const blip = { ...restored, candidates: { 'EXM-1': { ...restored.candidates['EXM-1'], outages: [{ from: at(5), to: at(10) }] } } }
assert.deepEqual(lostInterval(blip, blip.control.incidents[0], 'EXM-1'), { from: at(10), to: at(40) })

// Per-candidate reset: a device still holding the old attempt cannot bring it back.
const oldAttempt = { ...pc1, candidates: { 'EXM-1': { ...pc1.candidates['EXM-1'], loggedInAt: at(1), phase: 'submitted' as const } } }
const afterReset = { ...pc1, candidates: {}, control: { ...pc1.control, updatedAt: at(50), rev: 9, resets: { 'EXM-1': at(40) } } }
assert.equal(mergeState(afterReset, oldAttempt).candidates['EXM-1'], undefined)
assert.equal(mergeState(oldAttempt, afterReset).candidates['EXM-1'], undefined)
const fresh = { ...afterReset, candidates: { 'EXM-1': { ...pc1.candidates['EXM-1'], loggedInAt: at(60) } } }
assert.ok(mergeState(afterReset, fresh).candidates['EXM-1'])

console.log('core self-check passed')
