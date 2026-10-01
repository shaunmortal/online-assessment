// Pure exam logic shared by the browser app, the Vite relay and the self-check.
// No DOM access here: only globalThis.crypto (available in browsers and Node).

export type Lang = 'en' | 'hi'
export type Phase = 'login' | 'instructions' | 'gate' | 'exam' | 'submitted'
export type AuditKind =
  | 'release' | 'checkpoint' | 'heartbeat' | 'incident' | 'recovery' | 'approval'
  | 'access' | 'integrity' | 'ai' | 'submission' | 'tamper'
export type Policy = 'recover' | 'protect-time' | 'reschedule'
export type FaultKind = 'candidate-network' | 'service-outage'

export interface AuditEvent {
  id: string
  at: string
  kind: AuditKind
  title: string
  detail: string
  source: string
  candidateId?: string
  data?: Record<string, string | number | boolean | null>
  digest?: string // SHA-256 of canonicalEvent(), filled right after creation
  rev?: number // bumped only by the tamper demo, so the edited copy wins merges
}

export interface Checkpoint {
  id: string
  candidateId: string
  question: string
  answer: string
  at: string
  sequence: number
  status: 'verified' | 'queued'
  reconciledAt?: string
}

export interface ResponseState {
  answer?: string
  marked?: boolean
  visited?: boolean
  code?: string
  codeLang?: string
  tests?: { passed: number; total: number }
}

export interface Interval { from: string; to?: string }

export interface CandidateSlice {
  updatedAt: string
  rev?: number // bumped on every write; decides merges even within the same millisecond
  candidateId: string
  loggedInAt: string
  device?: string
  media?: { camera: boolean; fullscreen: boolean; obstructed: boolean; faces?: number | null }
  phase: Phase
  lang: Lang
  startedAt?: string
  submittedAt?: string
  submitReason?: 'candidate' | 'time-up' | 'reschedule' | 'cancelled'
  current: string
  responses: Record<string, ResponseState>
  lastHeartbeatAt?: string
  outages: Interval[] // heartbeat-loss intervals measured by the candidate browser
  assistedRequested: boolean
  warnings: number
  tabSwitches?: number
  telemetry?: Telemetry // device + network health reported every ~10 s (feeds early-warning prediction)
  deviceId?: string // the one browser allowed to run this attempt; signing in elsewhere takes over
  deviceClaimAt?: string // when deviceId was claimed: the latest claim wins regardless of slice revision
  lockedAt?: string // 2nd tab switch: paper locked until lockedUntil (timer keeps running)
  lockedUntil?: string
  suspendedAt?: string // 3rd tab switch: paper locked until an officer resumes or cancels
  report?: { at: string; reason: string; answered: number; phase: Phase }
  acknowledgements?: Record<string, { answer: 'yes' | 'no'; note?: string }> // candidate's answers about each detected issue
  acknowledgedAt?: string // "I could not take this exam"
  ai?: { checks: number; lastAt?: string; risk?: 'none' | 'low' | 'medium' | 'high'; summary?: string; faces?: number; error?: string }
}

export interface Message { id: string; at: string; to: string; text: string; auto?: boolean } // to: 'all' | service path | candidateId

export interface Telemetry {
  at: string
  rttMs: number // mean heartbeat round trip over the last ~20 s
  jitterMs: number
  baselineRttMs: number // median of the first samples of this attempt
  missed: number // heartbeats that failed without becoming an outage, last 5 min
  battery?: { level: number; charging: boolean }
  net?: { type?: string; downlinkMbps?: number; rttMs?: number }
}

export interface Receipt {
  id: string
  candidateId: string
  candidateName: string
  incidentId: string
  interval: { from: string; to: string; seconds: number }
  answersPreserved: number
  checkpointsPreserved: number
  policy: Policy
  creditSeconds: number
  reason: string
  officer: string
  decidedAt: string
  eventIds: string[] // exactly the events this receipt vouches for, in chain order
  auditHead: string
  hash: string
  serverSignature?: string // ECDSA P-256 over `hash`, added by the exam server after it re-verified the receipt
  keyId?: string
}

export interface Decision {
  policy: Policy
  recommended: Policy
  credits: Record<string, number> // candidateId -> seconds added to the timer
  reason: string
  officer: string
  at: string
  auto: boolean
  receipts: Record<string, Receipt> // one per affected candidate that was in the exam
}

export interface Incident {
  id: string
  kind: FaultKind
  servicePath: string
  startedAt: string
  restoredAt?: string
  affected: string[]
  detected?: boolean // opened by the heartbeat watchdog rather than the simulation controls
  platform?: boolean // many sessions across service paths dropped together (server/platform outage)
  decision?: Decision
}

export interface Reexam {
  status: 'granted' | 'rejected'
  at: string
  auto: boolean
  officer: string
  reason: string
  evidence: string[]
  receipt?: Receipt
}

export interface ControlSlice {
  updatedAt: string
  windowMinutes?: number // exam window measured from session start; closes for everyone at the same time
  reexams?: Record<string, Reexam> // per-candidate re-exam decisions (only the affected candidate gets one)
  unlocks?: Record<string, string> // officer resumed a locked/suspended candidate (candidateId -> time)
  cancellations?: Record<string, string> // officer cancelled a suspended attempt
  resets?: Record<string, string> // officer reset one candidate's attempt (slices signed in before this are dropped)
  messages?: Message[] // announcements to candidates (manual or automatic on incidents)
  riskReport?: { at: string; model: string; result: unknown } // last Claude post-exam risk report
  rev?: number
  faults: { wrongPaper: boolean; saveChannelDown: boolean }
  incidents: Incident[]
  assistedApproved: Record<string, string> // candidateId -> approval time
  thresholdSeconds: number
  graceSeconds: number
}

export interface ExamState {
  sessionId: string
  createdAt: string
  epoch?: number // bumped only by an explicit reset; a fresh device starts at 0 and adopts the live session
  candidates: Record<string, CandidateSlice> // each candidate device owns its own slice
  control: ControlSlice
  audit: AuditEvent[]
  checkpoints: Checkpoint[]
}

export const EXAM_SECONDS = 45 * 60
export const REORIENTATION_BUFFER = 30

export function now() {
  return new Date().toISOString()
}

export function shortId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createState(epoch = 0): ExamState {
  const at = now()
  return {
    sessionId: shortId('run'),
    createdAt: at,
    epoch,
    candidates: {},
    control: { updatedAt: at, faults: { wrongPaper: false, saveChannelDown: false }, incidents: [], assistedApproved: {}, thresholdSeconds: 180, graceSeconds: 20, windowMinutes: 60, reexams: {} },
    audit: [],
    checkpoints: [],
  }
}

// ---------- hashing / evidence chain ----------

export const TAB_LOCK_MINUTES = 10

// Graduated tab-switch response: 1st = warning, 2nd = 10-min lock, 3rd = suspended for an officer.
// Nothing is cancelled automatically; an officer resumes or cancels.
export function lockState(state: ExamState, id: string, at = Date.now()): 'none' | 'locked' | 'suspended' {
  const slice = state.candidates[id]
  if (!slice) return 'none'
  const resumed = state.control.unlocks?.[id]
  if (slice.suspendedAt && !(resumed && resumed >= slice.suspendedAt)) return 'suspended'
  if (slice.lockedUntil && Date.parse(slice.lockedUntil) > at && !(resumed && resumed >= slice.lockedAt!)) return 'locked'
  return 'none'
}

export const windowEndsAt = (state: ExamState) => Date.parse(state.createdAt) + (state.control.windowMinutes ?? 60) * 60_000

export function newCandidate(candidateId: string, firstQuestion: string, device?: string): CandidateSlice {
  const at = now()
  return { updatedAt: at, candidateId, loggedInAt: at, device, phase: 'instructions', lang: 'en', current: firstQuestion, responses: {}, outages: [], assistedRequested: false, warnings: 0 }
}

export async function sha256(value: string) {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function canonicalEvent(event: AuditEvent) {
  return JSON.stringify([event.id, event.at, event.kind, event.title, event.detail, event.source, event.candidateId ?? null, event.data ?? null])
}

export const eventOrder = (a: { at: string; id: string }, b: { at: string; id: string }) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)

export async function sealEvents(events: AuditEvent[]) {
  return Promise.all(events.map(async (event) => (event.digest ? event : { ...event, digest: await sha256(canonicalEvent(event)) })))
}

export interface ChainReport {
  ok: boolean
  head: string
  links: Array<{ id: string; head: string; valid: boolean }>
  firstBroken?: string
}

// head_0 = GENESIS:<session>, head_i = SHA256(head_{i-1} + stored digest_i).
// A link is invalid when the stored digest no longer matches the event content.
export async function verifyChain(sessionId: string, events: AuditEvent[]): Promise<ChainReport> {
  let head = `GENESIS:${sessionId}`
  const links: ChainReport['links'] = []
  let firstBroken: string | undefined
  for (const event of events) {
    const actual = await sha256(canonicalEvent(event))
    const valid = Boolean(event.digest) && event.digest === actual
    if (!valid && !firstBroken) firstBroken = event.id
    head = await sha256(head + (event.digest ?? actual))
    links.push({ id: event.id, head, valid })
  }
  return { ok: !firstBroken, head, links, firstBroken }
}

export function receiptBody(receipt: Omit<Receipt, 'hash'> | Receipt) {
  const { hash: _hash, serverSignature: _signature, keyId: _keyId, ...body } = receipt as Receipt
  return JSON.stringify(body)
}

export interface ReceiptCheck { ok: boolean; receiptIntact: boolean; eventsIntact: boolean; chainIntact: boolean; problem?: string }

export async function verifyReceipt(receipt: Receipt, sessionId: string, audit: AuditEvent[]): Promise<ReceiptCheck> {
  const receiptIntact = (await sha256(receiptBody(receipt))) === receipt.hash
  const byId = new Map(audit.map((event) => [event.id, event]))
  const claimed = receipt.eventIds.map((id) => byId.get(id))
  const missing = claimed.findIndex((event) => !event)
  if (missing >= 0) {
    return { ok: false, receiptIntact, eventsIntact: false, chainIntact: false, problem: `Event ${receipt.eventIds[missing]} is missing from the evidence store.` }
  }
  const report = await verifyChain(sessionId, claimed as AuditEvent[])
  const chainIntact = report.head === receipt.auditHead
  const problem = !receiptIntact
    ? 'The receipt fields were changed after sealing.'
    : !report.ok
      ? `Recorded event ${report.firstBroken} was edited after it was sealed.`
      : !chainIntact
        ? 'The evidence chain head no longer matches the sealed receipt.'
        : undefined
  return { ok: receiptIntact && report.ok && chainIntact, receiptIntact, eventsIntact: report.ok, chainIntact, problem }
}

// ---------- sync merge (browser tabs + WebSocket relay) ----------

function mergeById<T extends { id: string; at: string }>(left: T[], right: T[], prefer: (a: T, b: T) => T) {
  const merged = new Map<string, T>()
  for (const item of left) merged.set(item.id, item)
  for (const item of right) {
    const existing = merged.get(item.id)
    merged.set(item.id, existing ? prefer(existing, item) : item)
  }
  return [...merged.values()].sort(eventOrder)
}

const preferEvent = (a: AuditEvent, b: AuditEvent) => {
  if ((a.rev ?? 0) !== (b.rev ?? 0)) return (a.rev ?? 0) > (b.rev ?? 0) ? a : b
  if (Boolean(a.digest) !== Boolean(b.digest)) return a.digest ? a : b
  return b
}

const preferCheckpoint = (a: Checkpoint, b: Checkpoint) => (a.reconciledAt && !b.reconciledAt ? a : b)

const newer = <T extends { updatedAt: string; rev?: number }>(a: T, b: T) =>
  (b.rev ?? 0) !== (a.rev ?? 0) ? ((b.rev ?? 0) > (a.rev ?? 0) ? b : a) : b.updatedAt >= a.updatedAt ? b : a

// The old PC keeps bumping its revision with heartbeats, so device ownership merges on claim time instead.
const newerSlice = (a: CandidateSlice, b: CandidateSlice): CandidateSlice => {
  const chosen = newer(a, b)
  const other = chosen === a ? b : a
  return (other.deviceClaimAt ?? '') > (chosen.deviceClaimAt ?? '') ? { ...chosen, deviceId: other.deviceId, deviceClaimAt: other.deviceClaimAt, device: other.device } : chosen
}

// Candidate tab owns `candidate`, Control Tower owns `control`; logs merge by id.
export function mergeState(a: ExamState, b: ExamState): ExamState {
  if (a.sessionId !== b.sessionId) {
    // Explicit reset wins; otherwise keep the session that already has activity, so a
    // new PC joining mid-exam adopts the running session instead of wiping it.
    if ((a.epoch ?? 0) !== (b.epoch ?? 0)) return (b.epoch ?? 0) > (a.epoch ?? 0) ? b : a
    if (a.audit.length !== b.audit.length) return b.audit.length > a.audit.length ? b : a
    return b.createdAt < a.createdAt || (b.createdAt === a.createdAt && b.sessionId < a.sessionId) ? b : a
  }
  const candidates = { ...a.candidates }
  for (const [id, slice] of Object.entries(b.candidates)) candidates[id] = candidates[id] ? newerSlice(candidates[id], slice) : slice
  const control = newer(a.control, b.control)
  // A per-candidate reset wins over any device still holding the old attempt.
  for (const [id, at] of Object.entries(control.resets ?? {})) if (candidates[id] && candidates[id].loggedInAt <= at) delete candidates[id]
  return {
    ...a,
    candidates,
    control,
    audit: mergeById(a.audit, b.audit, preferEvent),
    checkpoints: mergeById(a.checkpoints, b.checkpoints, preferCheckpoint),
  }
}

// ---------- delta sync (scales to large halls: only changes travel, merged in O(changes)) ----------

export interface StatePatch {
  sessionId: string
  createdAt: string
  epoch?: number
  full?: boolean // a complete snapshot (first sync, reset, restore)
  candidates?: Record<string, CandidateSlice>
  control?: ControlSlice
  audit?: AuditEvent[]
  checkpoints?: Checkpoint[]
}

export const isPatch = (value: unknown): value is StatePatch =>
  Boolean(value && typeof (value as StatePatch).sessionId === 'string' && typeof (value as StatePatch).createdAt === 'string')

export function patchOf(state: ExamState, full = true): StatePatch {
  return { sessionId: state.sessionId, createdAt: state.createdAt, epoch: state.epoch, full, candidates: state.candidates, control: state.control, audit: state.audit, checkpoints: state.checkpoints }
}

const asState = (patch: StatePatch, control: ControlSlice): ExamState => ({
  sessionId: patch.sessionId, createdAt: patch.createdAt, epoch: patch.epoch, candidates: patch.candidates ?? {}, control: patch.control ?? control, audit: patch.audit ?? [], checkpoints: patch.checkpoints ?? [],
})

// Keeps one ExamState plus id indexes so each patch costs O(changed items), not O(whole log).
export class StateStore {
  state?: ExamState
  private events = new Map<string, AuditEvent>()
  private cps = new Map<string, Checkpoint>()

  private reindex() {
    this.events = new Map(this.state!.audit.map((event) => [event.id, event]))
    this.cps = new Map(this.state!.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]))
  }

  private upsert<T extends { id: string; at: string }>(list: T[], index: Map<string, T>, item: T, prefer: (a: T, b: T) => T) {
    const existing = index.get(item.id)
    if (existing) {
      const chosen = prefer(existing, item)
      if (chosen === existing) return false
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].id === item.id) { list[i] = chosen; break }
      index.set(item.id, chosen)
      return true
    }
    index.set(item.id, item)
    let lo = 0
    let hi = list.length
    if (!hi || eventOrder(list[hi - 1], item) <= 0) lo = hi // common case: newest event goes last
    else while (lo < hi) { const mid = (lo + hi) >> 1; if (eventOrder(list[mid], item) <= 0) lo = mid + 1; else hi = mid }
    list.splice(lo, 0, item)
    return true
  }

  // Returns true when the stored state changed. Mutates in place; callers copy for rendering.
  apply(patch: StatePatch): boolean {
    if (!this.state || patch.full || patch.sessionId !== this.state.sessionId) {
      if (this.state && patch.sessionId === this.state.sessionId) {
        this.state = mergeState(this.state, asState(patch, this.state.control))
      } else if (!this.state) {
        if (!patch.control) return false
        this.state = asState(patch, patch.control)
      } else {
        if (!patch.full || !patch.control) return false // only a full snapshot can switch sessions
        const next = mergeState(this.state, asState(patch, patch.control))
        if (next === this.state) return false
        this.state = next
      }
      this.reindex()
      return true
    }
    const state = this.state
    let changed = false
    for (const [id, slice] of Object.entries(patch.candidates ?? {})) {
      const current = state.candidates[id]
      const chosen = current ? newerSlice(current, slice) : slice
      if (chosen !== current) { state.candidates[id] = chosen; changed = true }
    }
    if (patch.control) {
      const chosen = newer(state.control, patch.control)
      if (chosen !== state.control) { state.control = chosen; changed = true }
    }
    for (const [id, at] of Object.entries(state.control.resets ?? {})) if (state.candidates[id] && state.candidates[id].loggedInAt <= at) { delete state.candidates[id]; changed = true }
    for (const event of patch.audit ?? []) changed = this.upsert(state.audit, this.events, event, preferEvent) || changed
    for (const checkpoint of patch.checkpoints ?? []) changed = this.upsert(state.checkpoints, this.cps, checkpoint, preferCheckpoint) || changed
    return changed
  }

  // A fresh object graph for React (new identities for the parts that may have changed).
  snapshot(): ExamState | undefined {
    return this.state && { ...this.state, candidates: { ...this.state.candidates }, audit: this.state.audit.slice(), checkpoints: this.state.checkpoints.slice() }
  }
}

export function isExamState(value: unknown): value is ExamState {
  const state = value as ExamState
  return Boolean(state?.sessionId && state.candidates && typeof state.candidates === 'object' && state.control?.updatedAt && Array.isArray(state.audit) && Array.isArray(state.checkpoints))
}

// ---------- simulated exam API + incidents ----------

export const openIncidents = (state: ExamState) => state.control.incidents.filter((incident) => !incident.restoredAt)

// The simulated exam API is "down" for a candidate while an injected, unrestored incident covers them.
export function apiReachable(state: ExamState, candidateId: string) {
  return !state.control.incidents.some((incident) => !incident.restoredAt && !incident.detected && incident.affected.includes(candidateId))
}

export const secondsBetween = (from: string, to: string) => Math.max(0, Math.ceil((Date.parse(to) - Date.parse(from)) / 1000))

// The interval the candidate's own browser measured (last good heartbeat -> first good one after);
// falls back to the incident window if that browser never reported (tab closed, crashed).
// Returns undefined while the measurement is still open.
export function lostInterval(state: ExamState, incident: Incident, candidateId: string): Interval | undefined {
  if (!incident.restoredAt) return undefined
  const slice = state.candidates[candidateId]
  if (slice) {
    const overlapping = slice.outages.filter((outage) => (outage.to ?? '9') > incident.startedAt && outage.from < incident.restoredAt!)
    if (overlapping.some((outage) => !outage.to)) return undefined
    if (overlapping.length) return { from: overlapping[0].from, to: overlapping[overlapping.length - 1].to }
  }
  return { from: incident.startedAt, to: incident.restoredAt }
}

export interface Loss { candidateId: string; path: string; at: string }

// Two or more sessions on the same service path losing heartbeat within 30 s = shared outage.
export function classifyLosses(losses: Loss[]): { scope: 'individual' | 'cohort'; path?: string; count: number } {
  const byPath = new Map<string, Loss[]>()
  for (const loss of losses) byPath.set(loss.path, [...(byPath.get(loss.path) ?? []), loss])
  for (const [path, group] of byPath) {
    const times = group.map((loss) => Date.parse(loss.at)).sort((a, b) => a - b)
    if (group.length >= 2 && times[times.length - 1] - times[0] <= 30_000) return { scope: 'cohort', path, count: group.length }
  }
  return { scope: 'individual', count: losses.length }
}

export interface Recommendation { policy: Policy; needsOfficer: boolean; reasons: string[] }

export function recommend(input: {
  scope: 'individual' | 'cohort'
  lostSeconds: number
  remainingSeconds: number
  queuedCheckpoints: number
  thresholdSeconds: number
  graceSeconds: number
}): Recommendation {
  const { scope, lostSeconds, remainingSeconds, queuedCheckpoints, thresholdSeconds, graceSeconds } = input
  if (lostSeconds >= thresholdSeconds || remainingSeconds < lostSeconds || queuedCheckpoints > 0) {
    return {
      policy: 'reschedule',
      needsOfficer: true,
      reasons: [
        lostSeconds >= thresholdSeconds ? `Interruption ${lostSeconds}s ≥ reschedule threshold ${thresholdSeconds}s.` : '',
        remainingSeconds < lostSeconds ? 'Remaining exam time is shorter than the time lost.' : '',
        queuedCheckpoints > 0 ? `${queuedCheckpoints} checkpoint(s) still unreconciled.` : '',
        `Only the ${scope === 'cohort' ? 'affected cohort' : 'affected candidate'} is rescheduled; everyone else is unaffected.`,
      ].filter(Boolean),
    }
  }
  if (scope === 'individual' && lostSeconds <= graceSeconds) {
    return {
      policy: 'recover',
      needsOfficer: false,
      reasons: [`Single-candidate interruption of ${lostSeconds}s (within ${graceSeconds}s grace).`, 'The candidate kept answering offline and all queued checkpoints synced; nothing to restore.'],
    }
  }
  return {
    policy: 'protect-time',
    needsOfficer: true,
    reasons: [
      scope === 'cohort' ? 'Correlated heartbeat loss on a shared service path.' : `Single-candidate interruption of ${lostSeconds}s exceeds the ${graceSeconds}s grace.`,
      `Candidates could keep answering offline; each affected candidate gets a ${REORIENTATION_BUFFER}s re-orientation buffer, plus any time the browser could not work offline (crash, closed tab).`,
      'All checkpoints reconciled without conflict; no marks are changed.',
    ],
  }
}

export function creditedSeconds(state: ExamState, candidateId: string) {
  const since = state.candidates[candidateId]?.loggedInAt ?? ''
  return state.control.incidents.reduce((total, incident) => total + (incident.decision && incident.decision.at >= since ? incident.decision.credits[candidateId] ?? 0 : 0), 0)
}

// Seconds this candidate was offline: every heartbeat-loss interval its own browser measured
// (an open one counts up to `at`). The exam timer keeps running; this is shown beside it and
// the candidate keeps answering offline (answers queue locally and sync on reconnect).
export function offlineSeconds(slice: CandidateSlice, at = Date.now(), within?: { from: string; to: string }) {
  return slice.outages.reduce((total, outage) => {
    let from = Date.parse(outage.from)
    let to = Math.min(outage.to ? Date.parse(outage.to) : at, at)
    if (within) {
      from = Math.max(from, Date.parse(within.from))
      to = Math.min(to, Date.parse(within.to))
    }
    return total + Math.max(0, (to - from) / 1000)
  }, 0)
}

export function remainingSeconds(state: ExamState, candidateId: string, at = Date.now()) {
  const slice = state.candidates[candidateId]
  if (!slice?.startedAt) return EXAM_SECONDS
  const end = slice.submittedAt ? Date.parse(slice.submittedAt) : at
  const elapsed = (end - Date.parse(slice.startedAt)) / 1000
  return Math.max(0, Math.floor(EXAM_SECONDS - elapsed + creditedSeconds(state, candidateId)))
}
