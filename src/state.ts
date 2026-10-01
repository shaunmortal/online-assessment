import { useCallback, useEffect, useRef, useState } from 'react'
import {
  StateStore, isPatch, patchOf, type StatePatch, apiReachable, classifyLosses, createState, offlineSeconds, TAB_LOCK_MINUTES, isExamState, lostInterval, mergeState, newCandidate, now, openIncidents, receiptBody,
  recommend, remainingSeconds, REORIENTATION_BUFFER, sealEvents, secondsBetween, sha256, shortId, verifyChain,
  type AuditEvent, type AuditKind, type CandidateSlice, type Checkpoint, type ControlSlice, type ExamState, type FaultKind,
  type Incident, type Lang, type Message, type Policy, type Receipt, type ResponseState,
} from './lib/core'
import { putCheckpoint, loadSnapshot, saveSnapshot } from './lib/idb'
import { BLUEPRINT, rosterEntry, seatLabel } from './data/paper'
import { QUESTIONS, paperInfo } from './lib/paperClient'

const STORAGE_KEY = 'examshield:v3'
const ME_KEY = 'examshield:me' // per tab, so one browser can host several candidates for testing
export const DOB_KEY = 'examshield:dob' // per tab: needed to request the time-locked paper key
const CHANNEL = 'examshield-sync-v3'
const HEARTBEAT_MS = 2000
const STALE_MS = 8000
const COHORT_WINDOW_MS = 30_000
const QUIET_MS = 15_000 // wait after a restore before auto-deciding, so flapping merges into one incident
const DEVICE_KEY = 'examshield:device'
const deviceId = (() => {
  const existing = window.sessionStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const created = shortId('dev')
  window.sessionStorage.setItem(DEVICE_KEY, created)
  return created
})()

export const OFFICER = 'Exam Officer · R. Mehta'

export function event(kind: AuditKind, title: string, detail: string, source: string, candidateId?: string, data?: AuditEvent['data']): AuditEvent {
  return { id: shortId('evt'), at: now(), kind, title, detail, source, candidateId, data }
}

const withEvents = (state: ExamState, ...events: AuditEvent[]): ExamState => ({ ...state, audit: [...state.audit, ...events] })
const patchSlice = (state: ExamState, id: string, patch: Partial<CandidateSlice>): ExamState =>
  state.candidates[id] ? { ...state, candidates: { ...state.candidates, [id]: { ...state.candidates[id], ...patch, updatedAt: now(), rev: (state.candidates[id].rev ?? 0) + 1 } } } : state
const patchControl = (state: ExamState, patch: Partial<ControlSlice>): ExamState => ({ ...state, control: { ...state.control, ...patch, updatedAt: now(), rev: (state.control.rev ?? 0) + 1 } })
const patchIncident = (state: ExamState, id: string, patch: Partial<Incident>) =>
  patchControl(state, { incidents: state.control.incidents.map((incident) => (incident.id === id ? { ...incident, ...patch } : incident)) })
const nextIncidentId = (state: ExamState) => `INC-${String(state.control.incidents.length + 42).padStart(3, '0')}`

function readLocal(): ExamState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isExamState(parsed)) return parsed
  } catch {
    // Fall through; IndexedDB hydration may still restore the session.
  }
  return createState()
}

function describeDevice() {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : 'OS'
  return `${browser} · ${os} · ${window.screen.width}×${window.screen.height}`
}

const lastRestoreFor = (state: ExamState, id: string) =>
  state.control.incidents.filter((incident) => incident.restoredAt && incident.affected.includes(id)).map((incident) => incident.restoredAt!).sort().pop()

// Facts the platform itself recorded about a candidate's loss of service. With `strong`, only the
// records that prove the candidate could NOT work (offline answering is possible, so plain offline
// time goes to an officer instead of an automatic re-exam).
export function reexamEvidence(state: ExamState, id: string, strong = false) {
  const slice = state.candidates[id]
  if (!slice) return []
  const evidence: string[] = []
  const blocks = state.audit.filter((item) => item.candidateId === id && item.kind === 'release' && item.data?.passed === false).length
  if (!slice.startedAt && blocks) evidence.push(`readiness gate blocked ${blocks} time(s); the exam never started`)
  const silent = state.control.incidents.filter((item) => item.detected && item.affected.includes(id) && !slice.outages.some((o) => (o.to ?? '9') > item.startedAt && o.from < (item.restoredAt ?? '9')))
  const silentSeconds = silent.reduce((total, item) => total + secondsBetween(item.startedAt, item.restoredAt ?? now()), 0)
  if (silentSeconds >= state.control.thresholdSeconds) evidence.push(`device was silent for ${silentSeconds}s (crash, power or closed tab), longer than the ${state.control.thresholdSeconds}s threshold`)
  const offline = Math.round(offlineSeconds(slice))
  if (!strong && offline > 0) evidence.push(`${offline}s offline (the candidate could keep answering offline)`)
  return evidence
}

// One detected issue: a line for the officer and a yes/no question the candidate confirms after submitting.
export interface ReportItem { key: string; line: string; question: string; questionHi: string }

export interface SessionReport { lines: string[]; items: ReportItem[]; offlineSeconds: number; outages: number; tabSwitches: number; warnings: number; integrity: number; aiFlags: number }

// Everything the candidate went through, attached to the submission and shown to the officer.
export function sessionReport(state: ExamState, id: string, at = Date.now()): SessionReport {
  const slice = state.candidates[id]
  const since = slice?.loggedInAt ?? ''
  const events = state.audit.filter((item) => item.candidateId === id && item.at >= since) // this attempt only
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour12: false })
  const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const outages = slice?.outages ?? []
  const offline = slice ? offlineSeconds(slice, at) : 0
  const matching = (test: (item: AuditEvent) => boolean) => events.filter(test)
  const first = (hits: AuditEvent[]) => (hits.length ? ` (first at ${time(hits[0].at)})` : '')
  const items: ReportItem[] = []
  const add = (key: string, hits: number, line: string, question: string, questionHi: string) => { if (hits) items.push({ key, line, question, questionHi }) }
  const firstHi = (hits: AuditEvent[]) => (hits.length ? ` (पहली बार ${time(hits[0].at)} पर)` : '')

  const ranges = outages.map((o) => `${time(o.from)}\u00a0–\u00a0${o.to ? time(o.to) : 'still\u00a0offline'}`).join(', ')
  add('connection', outages.length,
    `Internet/exam server lost ${outages.length} time(s), ${mmss(offline)} offline in total: ${ranges}. Answers were saved on the device and synced.`,
    `Your internet / exam-server connection dropped ${outages.length} time(s): ${ranges}. Did this happen?`,
    `परीक्षा के बीच आपका इंटरनेट / परीक्षा सर्वर से कनेक्शन ${outages.length} बार कटा: ${ranges}। क्या ऐसा हुआ था?`)
  const tab = slice?.tabSwitches ?? 0
  const tabHits = matching((item) => typeof item.data?.tabSwitch === 'number')
  add('tab', tab,
    `Tab switched ${tab} time(s)${slice?.submitReason === 'cancelled' ? ' — attempt cancelled by officer' : slice?.suspendedAt ? ' — suspended for officer review' : slice?.lockedAt ? ` — locked for ${TAB_LOCK_MINUTES} min at ${time(slice.lockedAt)}` : ' — warning given'}.`,
    `You left the exam tab ${tab} time(s)${first(tabHits)}. Did you switch away from the exam?`,
    `आपने परीक्षा का टैब ${tab} बार छोड़ा${firstHi(tabHits)}। क्या आपने परीक्षा से हटकर दूसरी जगह स्विच किया था?`)
  const fullscreen = matching((item) => item.title.startsWith('Exited fullscreen'))
  add('fullscreen', fullscreen.length, `Left fullscreen ${fullscreen.length} time(s)${first(fullscreen)}.`, `You left fullscreen ${fullscreen.length} time(s)${first(fullscreen)}. Did this happen?`, `आपने ${fullscreen.length} बार फुलस्क्रीन छोड़ी${firstHi(fullscreen)}। क्या ऐसा हुआ था?`)
  const camera = matching((item) => /^(Camera stream ended|Microphone stream ended|Camera view covered)/.test(item.title))
  add('camera', camera.length, `Camera/microphone problem ${camera.length} time(s)${first(camera)}.`, `Your camera or microphone stopped or was covered ${camera.length} time(s)${first(camera)}. Did this happen?`, `आपका कैमरा या माइक्रोफ़ोन ${camera.length} बार बंद हुआ या ढका गया${firstHi(camera)}। क्या ऐसा हुआ था?`)
  const clipboard = matching((item) => item.title.startsWith('Protected content') || item.title.startsWith('External paste'))
  add('clipboard', clipboard.length, `${clipboard.length} blocked copy/paste/right-click attempt(s)${first(clipboard)}.`, `A copy, paste or right-click was attempted ${clipboard.length} time(s)${first(clipboard)}. Did you do this?`, `कॉपी, पेस्ट या राइट-क्लिक ${clipboard.length} बार करने की कोशिश हुई${firstHi(clipboard)}। क्या आपने ऐसा किया था?`)
  const multi = matching((item) => item.kind === 'ai' && (item.title.startsWith('Multiple faces') || item.data?.otherPerson === true || Number(item.data?.faces) > 1))
  add('people', multi.length, `More than one person in view ${multi.length} time(s)${first(multi)}.`, `The camera saw more than one person ${multi.length} time(s)${first(multi)}. Was someone else near you?`, `कैमरे में ${multi.length} बार एक से ज़्यादा व्यक्ति दिखे${firstHi(multi)}। क्या आपके पास कोई और था?`)
  const noFace = matching((item) => item.kind === 'ai' && (item.title === 'No face in view' || (item.data?.source !== 'on-device' && item.data?.faces === 0)))
  add('absent', noFace.length, `Candidate not in view ${noFace.length} time(s)${first(noFace)}.`, `You were not visible on camera ${noFace.length} time(s)${first(noFace)}. Did you leave your seat or move out of view?`, `आप ${noFace.length} बार कैमरे में दिखाई नहीं दिए${firstHi(noFace)}। क्या आप अपनी सीट से उठे थे या कैमरे से हट गए थे?`)
  const device = matching((item) => item.kind === 'ai' && item.data?.device === true)
  // Seat problems an invigilator recorded (power cut, PC failure, ...): the candidate confirms them too.
  const seat = matching((item) => item.data?.action === 'invigilator-report' && item.data?.report !== 'malpractice')
  add('seat', seat.length, `Invigilator recorded a seat problem ${seat.length} time(s): ${seat.map((item) => `${item.title.replace(/^INVIGILATOR: /, '').replace(/ at .*$/, '')} at ${time(item.at)}`).join(', ')}.`,
    `The invigilator recorded a problem at your seat: ${seat.map((item) => `${item.title.replace(/^INVIGILATOR: /, '').replace(/ at .*$/, '').toLowerCase()} at ${time(item.at)}`).join(', ')}. Did this happen?`,
    `निरीक्षक ने आपकी सीट पर समस्या दर्ज की: ${seat.map((item) => `${({ 'power-cut': 'बिजली कटौती', 'pc-failure': 'कंप्यूटर खराबी' } as Record<string, string>)[String(item.data?.report)] ?? 'सीट की समस्या'} (${time(item.at)})`).join(', ')}। क्या ऐसा हुआ था?`)
  add('device', device.length, `Phone or other device seen by the AI proctor ${device.length} time(s)${first(device)}.`, `A phone or other device was seen on camera ${device.length} time(s)${first(device)}. Was a device in view?`, `कैमरे में ${device.length} बार फ़ोन या कोई अन्य डिवाइस दिखा${firstHi(device)}। क्या कोई डिवाइस सामने था?`)

  const lines = items.map((item) => item.line)
  const queued = state.checkpoints.filter((c) => c.candidateId === id && c.reconciledAt && c.at >= since).length
  if (queued) lines.splice(outages.length ? 1 : 0, 0, `${queued} answer(s) were given offline and synced after reconnecting.`)
  const looking = matching((item) => item.kind === 'ai' && item.data?.lookingAway === true).length
  if (looking) lines.push(`Looking away from the screen ${looking} time(s) (AI observation, not asked).`)
  if (!lines.length) lines.push('No connection or integrity issues recorded.')
  return {
    lines,
    items,
    offlineSeconds: Math.round(offline),
    outages: outages.length,
    tabSwitches: tab,
    warnings: slice?.warnings ?? 0,
    integrity: events.filter((item) => item.kind === 'integrity').length,
    aiFlags: events.filter((item) => item.kind === 'ai' && item.data?.risk !== undefined && item.data.risk !== 'none').length,
  }
}

async function collectTelemetry(samples: number[], baseline: number[], missed: number[]): Promise<CandidateSlice['telemetry']> {
  const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)
  const jitter = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, samples.length))
  const sorted = [...baseline].sort((a, b) => a - b)
  let battery: { level: number; charging: boolean } | undefined
  try {
    const manager = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.()
    if (manager) battery = { level: Math.round(manager.level * 100), charging: manager.charging }
  } catch {
    // Battery API not available (Firefox/Safari)
  }
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection
  return {
    at: now(),
    rttMs: Math.round(mean),
    jitterMs: Math.round(jitter),
    baselineRttMs: Math.round(sorted[Math.floor(sorted.length / 2)] ?? mean),
    missed: missed.filter((time) => Date.now() - time < 300_000).length,
    battery,
    net: connection ? { type: connection.effectiveType, downlinkMbps: connection.downlink, rttMs: connection.rtt } : undefined,
  }
}

// Officer announcements plus automatic notices derived from the shared incident record, so every
// device shows the same messages without anyone having to remember to send them.
export function messagesFor(state: ExamState, id: string): Message[] {
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour12: false })
  const manual = (state.control.messages ?? []).filter((message) => message.to === 'all' || message.to === id || message.to === rosterEntry(id)?.path)
  const automatic: Message[] = state.control.incidents.filter((incident) => incident.affected.includes(id)).flatMap((incident) => [
    { id: `${incident.id}:open`, at: incident.startedAt, to: id, auto: true, text: `We noticed a connection problem on your session at ${time(incident.startedAt)} (${incident.id}). Keep answering — your answers are saved on your device and sync automatically.` },
    ...(incident.decision ? [{ id: `${incident.id}:decided`, at: incident.decision.at, to: id, auto: true, text: `${incident.id} reviewed: ${incident.decision.policy === 'recover' ? 'no time was lost — everything you answered offline is safe' : incident.decision.policy === 'protect-time' ? `${incident.decision.credits[id] ?? 0}s extra time added to your timer` : 'you will get a re-exam; no other candidate is affected'}. Your Fairness Receipt is ready.` }] : []),
  ])
  const reexam = state.control.reexams?.[id]
  if (reexam?.status === 'granted') automatic.push({ id: `reexam:${id}`, at: reexam.at, to: id, auto: true, text: 'A re-exam has been granted to you only. The exam office will share your new slot.' })
  return [...manual, ...automatic].sort((a, b) => a.at.localeCompare(b.at))
}

async function signReceipt(receipt: Receipt): Promise<Pick<Receipt, 'serverSignature' | 'keyId'> | undefined> {
  try {
    const response = await fetch('/api/sign-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receipt }) })
    if (!response.ok) return undefined
    const body = await response.json()
    return { serverSignature: body.signature, keyId: body.keyId }
  } catch {
    return undefined
  }
}

export function heartbeatAge(slice: CandidateSlice, at = Date.now()) {
  return Math.max(0, Math.round((at - Date.parse(slice.lastHeartbeatAt ?? slice.startedAt ?? slice.loggedInAt)) / 1000))
}

export interface IncidentAnalysis {
  scope: 'individual' | 'cohort'
  path?: string
  lostSeconds: number
  ready: boolean
  policy: Policy
  needsOfficer: boolean
  reasons: string[]
  credits: (policy: Policy) => Record<string, number>
  intervals: Record<string, { from: string; to: string; seconds: number } | undefined>
}

export function analyseIncident(state: ExamState, incident: Incident, at = Date.now()): IncidentAnalysis {
  const losses = incident.affected.map((id) => {
    const outage = state.candidates[id]?.outages.find((item) => (item.to ?? '9') > incident.startedAt)
    return { candidateId: id, path: rosterEntry(id)?.path ?? incident.servicePath, at: outage?.from ?? incident.startedAt }
  })
  const correlation = incident.platform ? { scope: 'cohort' as const, path: 'all service paths', count: losses.length } : classifyLosses(losses)
  const intervals: IncidentAnalysis['intervals'] = {}
  for (const id of incident.affected) {
    const interval = lostInterval(state, incident, id)
    intervals[id] = interval?.to ? { from: interval.from, to: interval.to, seconds: secondsBetween(interval.from, interval.to) } : undefined
  }
  const ongoing = incident.restoredAt ? 0 : secondsBetween(incident.startedAt, new Date(at).toISOString())
  const lostSeconds = Math.max(ongoing, 0, ...Object.values(intervals).map((interval) => interval?.seconds ?? 0))
  const inExam = incident.affected.filter((id) => state.candidates[id]?.startedAt)
  const rec = recommend({
    scope: correlation.scope,
    lostSeconds,
    remainingSeconds: inExam.length ? Math.min(...inExam.map((id) => remainingSeconds(state, id, at))) : Number.POSITIVE_INFINITY,
    queuedCheckpoints: state.checkpoints.filter((checkpoint) => incident.affected.includes(checkpoint.candidateId) && checkpoint.status === 'queued').length,
    thresholdSeconds: state.control.thresholdSeconds,
    graceSeconds: state.control.graceSeconds,
  })
  return {
    scope: correlation.scope,
    path: correlation.path,
    lostSeconds,
    // A candidate the officer reset no longer has an attempt to measure; don't wait for them forever.
    ready: Boolean(incident.restoredAt) && incident.affected.every((id) => intervals[id] || !state.candidates[id]),
    policy: rec.policy,
    needsOfficer: rec.needsOfficer,
    reasons: rec.reasons,
    // Time the browser measured offline was still usable (offline answering); credit only the rest
    // (crashed or closed tab) plus the re-orientation buffer for protect-time.
    credits: (policy) => Object.fromEntries(incident.affected.map((id) => {
      const interval = intervals[id]
      const slice = state.candidates[id]
      const unfrozen = interval && slice ? Math.max(0, Math.round((Date.parse(interval.to) - Date.parse(interval.from)) / 1000 - offlineSeconds(slice, at, interval))) : 0
      return [id, policy === 'reschedule' ? 0 : unfrozen + (policy === 'protect-time' ? REORIENTATION_BUFFER : 0)]
    })),
    intervals,
  }
}

export function useExam() {
  const [state, setState] = useState<ExamState>(readLocal)
  const [me, setMe] = useState<string | null>(() => window.sessionStorage.getItem(ME_KEY))
  const [syncConnected, setSyncConnected] = useState(false)
  const [serverReachable, setServerReachable] = useState(true)
  const stateRef = useRef(state)
  const meRef = useRef(me)
  const serverReachableRef = useRef(true)
  const lastGoodRef = useRef<string | undefined>(undefined)
  const failStreak = useRef(0)
  const failStart = useRef<string | undefined>(undefined)
  const relayEverOpen = useRef(false)
  const signAttempts = useRef(new Map<string, number>())
  const rttSamples = useRef<number[]>([])
  const rttBaseline = useRef<number[]>([])
  const missedAt = useRef<number[]>([])
  const lastTelemetry = useRef(0)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const relayRef = useRef<WebSocket | null>(null)
  const clientId = useRef(shortId('client')).current
  meRef.current = me

  // ---- sync: BroadcastChannel/localStorage/IndexedDB carry full snapshots on this machine;
  // the relay carries deltas only (what it doesn't know yet), merged in O(changes) by a StateStore.
  const storeRef = useRef<StateStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new StateStore()
    storeRef.current.apply(patchOf(state))
  }
  const known = useRef(new WeakSet<object>()) // objects the relay already has
  const knownSession = useRef('')
  const flushTimer = useRef<number | undefined>(undefined)
  const persistTimer = useRef<number | undefined>(undefined)

  const persist = useCallback(() => {
    if (persistTimer.current) return
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = undefined
      const snapshot = stateRef.current
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
      } catch {
        // IndexedDB below is the durable copy.
      }
      void saveSnapshot(snapshot).catch(() => undefined)
    }, 800)
  }, [])

  // Pending relay patches are folded into stateRef before any local change is computed.
  const flush = useCallback(() => {
    if (flushTimer.current === undefined) return
    window.clearTimeout(flushTimer.current)
    flushTimer.current = undefined
    const snapshot = storeRef.current!.snapshot()
    if (!snapshot) return
    stateRef.current = snapshot
    setState(snapshot)
    persist()
  }, [persist])

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== undefined) return
    flushTimer.current = window.setTimeout(() => { flushTimer.current = -1; flush() }, 120)
  }, [flush])

  const remember = (patch: StatePatch) => {
    if (patch.full) knownSession.current = patch.sessionId
    for (const item of [...Object.values(patch.candidates ?? {}), ...(patch.control ? [patch.control] : []), ...(patch.audit ?? []), ...(patch.checkpoints ?? [])]) known.current.add(item)
  }

  // Everything in `next` the relay has not seen yet.
  const diff = (next: ExamState): StatePatch | null => {
    if (knownSession.current !== next.sessionId) return patchOf(next)
    const patch: StatePatch = { sessionId: next.sessionId, createdAt: next.createdAt, epoch: next.epoch }
    const candidates = Object.entries(next.candidates).filter(([, slice]) => !known.current.has(slice))
    if (candidates.length) patch.candidates = Object.fromEntries(candidates)
    if (!known.current.has(next.control)) patch.control = next.control
    const audit = next.audit.filter((event) => !known.current.has(event))
    if (audit.length) patch.audit = audit
    const checkpoints = next.checkpoints.filter((checkpoint) => !known.current.has(checkpoint))
    if (checkpoints.length) patch.checkpoints = checkpoints
    return patch.candidates || patch.control || patch.audit || patch.checkpoints ? patch : null
  }

  const role = window.location.pathname.startsWith('/exam') ? 'candidate' : window.location.pathname.startsWith('/ops') ? 'ops' : 'viewer'
  const sendRelay = (envelope: Record<string, unknown>) => {
    const passcode = role === 'candidate' ? undefined : window.sessionStorage.getItem('examshield:officer') ?? undefined
    if (relayRef.current?.readyState === WebSocket.OPEN) relayRef.current.send(JSON.stringify({ source: clientId, role, me: meRef.current ?? undefined, passcode, ...envelope }))
  }

  const write = useCallback((next: ExamState) => {
    stateRef.current = next
    setState(next)
    persist()
    channelRef.current?.postMessage(next)
    const patch = diff(next)
    if (!patch) return
    storeRef.current!.apply(patch)
    if (relayRef.current?.readyState === WebSocket.OPEN) {
      sendRelay({ patch })
      remember(patch)
    }
  }, [clientId, persist]) // eslint-disable-line react-hooks/exhaustive-deps

  // Full snapshots from this machine (other tabs, storage, IndexedDB).
  const apply = useCallback((incoming: unknown) => {
    if (!isExamState(incoming)) return
    if (storeRef.current!.apply(patchOf(incoming))) scheduleFlush()
  }, [scheduleFlush])

  const mutate = useCallback((recipe: (current: ExamState) => ExamState) => {
    flush()
    const current = stateRef.current
    const next = recipe(current)
    if (next !== current) write(next)
  }, [write, flush])

  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
    channelRef.current = channel
    if (channel) channel.onmessage = (message) => apply(message.data)
    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== STORAGE_KEY || !storageEvent.newValue) return
      try {
        apply(JSON.parse(storageEvent.newValue))
      } catch {
        // ignore malformed storage writes
      }
    }
    window.addEventListener('storage', onStorage)
    void loadSnapshot().then(apply).catch(() => undefined)
    return () => {
      window.removeEventListener('storage', onStorage)
      channel?.close()
      channelRef.current = null
    }
  }, [apply])

  useEffect(() => {
    let alive = true
    let retry: number | undefined
    const connect = () => {
      const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/examshield-sync`)
      relayRef.current = socket
      socket.onopen = () => {
        if (!alive) return
        setSyncConnected(true)
        flush()
        const full = patchOf(stateRef.current)
        sendRelay({ patch: full }) // after a reconnect, upload everything once (offline answers included)
        known.current = new WeakSet()
        remember(full)
      }
      socket.onmessage = (message) => {
        try {
          const envelope = JSON.parse(String(message.data)) as { source?: string; patch?: unknown }
          if (envelope.source === clientId || !isPatch(envelope.patch)) return
          remember(envelope.patch)
          if (storeRef.current!.apply(envelope.patch)) scheduleFlush()
        } catch {
          // ignore malformed relay frames
        }
      }
      socket.onclose = () => {
        if (!alive) return
        setSyncConnected(false)
        retry = window.setTimeout(connect, 1500)
      }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => {
      alive = false
      window.clearTimeout(retry)
      const socket = relayRef.current
      if (socket) {
        socket.onclose = null
        socket.close()
      }
      relayRef.current = null
    }
  }, [apply, clientId, flush, scheduleFlush]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the relay which candidate this tab is, so it routes that candidate's updates here.
  useEffect(() => { sendRelay({}) }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seal new events with their SHA-256 digest. Each tab seals what it created (candidate tabs their own
  // events, the Control Tower everything else); anything left unsealed for 10 s is sealed by whoever sees it.
  useEffect(() => {
    const mine = (event: AuditEvent) => {
      if (Date.now() - Date.parse(event.at) > 10_000) return true
      const fromCandidate = event.source.startsWith('Candidate') || event.source.startsWith('AI proctor')
      return role === 'candidate' ? fromCandidate && event.candidateId === meRef.current : !fromCandidate
    }
    const pending = state.audit.filter((item) => !item.digest && mine(item))
    if (!pending.length) return
    let cancelled = false
    void sealEvents(pending).then((sealed) => {
      if (cancelled) return
      const byId = new Map(sealed.map((item) => [item.id, item]))
      mutate((current) => ({ ...current, audit: current.audit.map((item) => (item.digest ? item : byId.get(item.id) ?? item)) }))
    })
    return () => { cancelled = true }
  }, [state.audit, mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = state.candidates[me ?? ''] as CandidateSlice | undefined
  const myId = () => meRef.current ?? ''
  const mySource = () => `Candidate app · ${myId()}`
  const patchMe = (current: ExamState, patch: Partial<CandidateSlice>) => patchSlice(current, myId(), patch)

  // ---------------- candidate actions (operate on this tab's candidate) ----------------

  const login = useCallback((rawId: string, dob: string) => {
    const entry = rosterEntry(rawId.trim().toUpperCase())
    if (!entry || entry.dob !== dob.replace(/\D/g, '')) return 'Invalid Candidate ID or Date of Birth.'
    window.sessionStorage.setItem(ME_KEY, entry.id)
    window.sessionStorage.setItem(DOB_KEY, entry.dob)
    meRef.current = entry.id
    setMe(entry.id)
    const device = describeDevice()
    mutate((current) => {
      const existing = current.candidates[entry.id]
      const resumed = Boolean(existing && existing.phase !== 'login')
      const takeover = Boolean(resumed && existing!.deviceId && existing!.deviceId !== deviceId && (existing!.phase === 'exam' || existing!.phase === 'gate'))
      // An invigilator-approved move to a spare PC (last 15 min) is a documented device change, not an alert.
      const moved = Boolean(takeover && current.control.seatMoves?.[entry.id] && Date.now() - Date.parse(current.control.seatMoves[entry.id]) < 15 * 60_000)
      const claim = { device, deviceId, deviceClaimAt: now() }
      const slice = resumed ? { ...existing!, ...claim, updatedAt: now(), rev: (existing!.rev ?? 0) + 1 } : { ...newCandidate(entry.id, BLUEPRINT[0].id, device), ...claim, rev: (existing?.rev ?? 0) + 1 }
      return withEvents(
        { ...current, candidates: { ...current.candidates, [entry.id]: slice } },
        ...(moved ? [event('access', `${entry.id} moved to a spare PC (approved by invigilator)`, `The attempt continues on ${device} with all saved answers; the timer kept running.`, `Candidate app · ${entry.id}`, entry.id, { action: 'seat-move' })] : []),
        ...(takeover && !moved ? [event('integrity', `SECOND DEVICE — ${entry.id} signed in on another device`, `The attempt moved to ${device}; the previous device was signed out automatically. Review whether this was a genuine device change.`, `Candidate app · ${entry.id}`, entry.id, { alert: true, action: 'device-takeover' })] : []),
        event('access', resumed ? 'Candidate signed in again (session resumed)' : 'Candidate signed in', `${entry.name} (${entry.id}) at ${entry.centre} authenticated on ${device}.${resumed ? ` Resumed at phase "${existing!.phase}".` : ''}`, `Candidate app · ${entry.id}`, entry.id, { device, centre: entry.centre, resumed }),
      )
    })
    return undefined
  }, [mutate])

  // Pull this candidate's saved attempt from the exam server before signing in (resume on any PC).
  const fetchCandidate = useCallback(async (id: string, dob: string) => {
    try {
      const response = await fetch('/api/candidate-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, dob }) })
      if (!response.ok) return
      const { patch } = await response.json()
      if (isPatch(patch) && storeRef.current!.apply(patch)) {
        remember(patch)
        flushTimer.current = -1
        flush()
      }
    } catch {
      // offline sign-in still works from this device's own copy
    }
  }, [flush]) // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(ME_KEY)
    setMe(null)
  }, [])

  const acceptInstructions = useCallback((lang: Lang) => {
    mutate((current) => withEvents(
      patchMe(current, { phase: 'gate', lang }),
      event('access', 'Instructions acknowledged', `Declaration accepted; question language ${lang === 'hi' ? 'Hindi' : 'English'}.`, mySource(), myId(), { lang }),
    ))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const recordGate = useCallback((passed: boolean, failures: string[]) => {
    mutate((current) => withEvents(current, event('release', passed ? 'Readiness gate passed' : 'Readiness gate blocked entry', passed ? 'Paper manifest, language pack, timer, answer-save channel and exam-server heartbeat verified.' : failures.join(' '), 'Release Gate', myId(), { passed })))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const startExam = useCallback(() => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      if (!slice || slice.phase === 'exam') return current
      // First start opens this candidate's own (shuffled) first question.
      const first = slice.startedAt ? slice.current : QUESTIONS[0]?.id ?? slice.current
      return withEvents(
        patchMe(current, {
          phase: 'exam',
          startedAt: slice.startedAt ?? now(),
          lastHeartbeatAt: now(),
          current: first,
          responses: { ...slice.responses, [first]: { ...slice.responses[first], visited: true } },
        }),
        event('access', 'Exam timer started', `${myId()} passed the readiness gate and started the paper${paperInfo ? ` (verified paper fingerprint #${paperInfo.root.slice(0, 12)})` : ''}.`, mySource(), myId(), paperInfo ? { paperRoot: paperInfo.root } : undefined),
      )
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLang = useCallback((lang: Lang) => mutate((current) => patchMe(current, { lang })), [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = useCallback((question: string) => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      return slice ? patchMe(current, { current: question, responses: { ...slice.responses, [question]: { ...slice.responses[question], visited: true } } }) : current
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateResponse = useCallback((question: string, patch: Partial<ResponseState>) => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      return slice ? patchMe(current, { responses: { ...slice.responses, [question]: { ...slice.responses[question], ...patch } } }) : current
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMarked = useCallback((question: string, marked: boolean) => updateResponse(question, { marked }), [updateResponse])

  // Every answer change becomes a sequenced checkpoint: IndexedDB first, then the shared log.
  const saveAnswer = useCallback(async (question: string, answer: string | undefined, extra: Partial<ResponseState> = {}) => {
    const current = stateRef.current
    const id = myId()
    if (!current.candidates[id]) return
    const reachable = serverReachableRef.current && apiReachable(current, id) && !current.control.faults.saveChannelDown
    const recorded = extra.code !== undefined ? `code#${(await sha256(extra.code)).slice(0, 12)} (${extra.code.length} chars)` : answer ?? '(cleared)'
    const checkpoint: Checkpoint = {
      id: shortId('cp'),
      candidateId: id,
      question,
      answer: recorded,
      at: now(),
      sequence: current.checkpoints.filter((item) => item.candidateId === id).length + 1,
      status: reachable ? 'verified' : 'queued',
    }
    let stored = 'indexeddb'
    try {
      await putCheckpoint(checkpoint)
    } catch {
      stored = 'memory-only'
    }
    mutate((latest) => {
      const slice = latest.candidates[id]
      if (!slice) return latest
      return withEvents(
        { ...patchSlice(latest, id, { responses: { ...slice.responses, [question]: { ...slice.responses[question], ...extra, answer, visited: true } } }), checkpoints: [...latest.checkpoints, checkpoint] },
        event('checkpoint', `Answer checkpoint #${checkpoint.sequence} ${checkpoint.status === 'verified' ? 'saved' : 'queued on device'}`, `Question ${question}: ${recorded}. Stored in ${stored === 'indexeddb' ? 'IndexedDB' : 'memory only'}${checkpoint.status === 'queued' ? '; server unreachable, reconciles on recovery' : ''}.`, `Candidate app · ${id}`, id, { question, answer: recorded, sequence: checkpoint.sequence, status: checkpoint.status, stored }),
      )
    })
  }, [mutate])

  const submit = useCallback(async (reason: 'candidate' | 'time-up' | 'reschedule') => {
    const id = myId()
    const slice = stateRef.current.candidates[id]
    if (slice?.phase !== 'exam') return
    const answered = BLUEPRINT.filter((question) => slice.responses[question.id]?.answer !== undefined).length
    const digest = await sha256(JSON.stringify(BLUEPRINT.map((question) => [question.id, slice.responses[question.id]?.answer ?? null, slice.responses[question.id]?.code ?? null])))
    const report = sessionReport(stateRef.current, id)
    mutate((latest) => withEvents(
      patchSlice(latest, id, { phase: 'submitted', submittedAt: now(), submitReason: reason }),
      event('submission', reason === 'reschedule' ? 'Attempt closed for targeted reschedule' : reason === 'time-up' ? 'Exam auto-submitted at time-up' : 'Candidate submitted the exam', `${answered}/${BLUEPRINT.length} answered. Response digest ${digest.slice(0, 16)}…${paperInfo ? ` Paper fingerprint #${paperInfo.root.slice(0, 12)}.` : ''} Session report: ${report.lines.join(' ')}`, `Candidate app · ${id}`, id, { answered, responseDigest: digest, paperRoot: paperInfo?.root ?? null, reason, offlineSeconds: report.offlineSeconds, outages: report.outages, tabSwitches: report.tabSwitches, warnings: report.warnings }),
    ))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const recordSignal = useCallback((title: string, detail: string, kind: AuditKind = 'integrity', data?: AuditEvent['data']) => {
    const id = myId()
    if (!id) return
    mutate((current) => withEvents(current, event(kind, title, detail, kind === 'ai' ? `AI proctor · ${id}` : `Candidate browser · ${id}`, id, data)))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const addWarning = useCallback(() => {
    mutate((current) => patchMe(current, { warnings: (current.candidates[myId()]?.warnings ?? 0) + 1 }))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const setAiStatus = useCallback((ai: CandidateSlice['ai']) => mutate((current) => patchMe(current, { ai })), [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const reportMedia = useCallback((media: NonNullable<CandidateSlice['media']>) => {
    mutate((current) => {
      const old = current.candidates[myId()]?.media
      return old && old.camera === media.camera && old.fullscreen === media.fullscreen && old.obstructed === media.obstructed && old.faces === media.faces ? current : patchMe(current, { media })
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  const requestAssisted = useCallback(() => {
    mutate((current) => current.candidates[myId()]?.assistedRequested ? current : withEvents(
      patchMe(current, { assistedRequested: true }),
      event('integrity', 'Assisted integrity review requested', 'Camera, live response or fullscreen needs an accommodation. Entry stays locked until an officer approves.', `Candidate browser · ${myId()}`, myId()),
    ))
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Candidate could not take the exam (line never came back before the window closed).
  const reportAffected = useCallback((reason: string) => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      if (!slice || slice.report) return current
      const answered = Object.values(slice.responses).filter((response) => response.answer !== undefined).length
      return withEvents(
        patchMe(current, { report: { at: now(), reason, answered, phase: slice.phase }, phase: 'submitted', submittedAt: slice.submittedAt ?? now(), submitReason: 'reschedule' }),
        event('incident', 'Candidate reported: could not take the exam', `${reason} ${answered} answer(s) were saved before the interruption. Report sent from the candidate device (queued there if offline).`, mySource(), myId(), { answered, phase: slice.phase }),
      )
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // After submitting, the candidate confirms or disputes each detected issue. Sealed into the evidence chain.
  const acknowledge = useCallback((answers: Record<string, { answer: 'yes' | 'no'; note?: string }>) => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      if (!slice || slice.acknowledgedAt) return current
      const report = sessionReport(current, myId())
      const disputed = report.items.filter((item) => answers[item.key]?.answer === 'no')
      return withEvents(
        patchMe(current, { acknowledgements: answers, acknowledgedAt: now() }),
        event('submission', disputed.length ? `Candidate disputed ${disputed.length} of ${report.items.length} reported issue(s)` : `Candidate confirmed all ${report.items.length} reported issue(s)`,
          report.items.map((item) => `${answers[item.key]?.answer === 'no' ? 'DISPUTED' : 'CONFIRMED'}: ${item.line}${answers[item.key]?.note ? ` — candidate: "${answers[item.key].note}"` : ''}`).join(' '),
          mySource(), myId(), { confirmed: report.items.length - disputed.length, disputed: disputed.length, ...Object.fromEntries(report.items.map((item) => [item.key, answers[item.key]?.answer ?? null])) }),
      )
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Graduated tab-switch response (see lockState): warning → 10-min lock → suspended for an officer.
  const tabSwitch = useCallback(() => {
    mutate((current) => {
      const slice = current.candidates[myId()]
      if (!slice || slice.phase !== 'exam') return current
      const count = (slice.tabSwitches ?? 0) + 1
      const base = { tabSwitches: count, warnings: slice.warnings + 1 }
      const source = `Candidate browser · ${myId()}`
      if (count === 1) {
        return withEvents(patchMe(current, base), event('integrity', `TAB SWITCH #1 — warning to ${myId()}`, 'Candidate left the exam tab. First warning shown; the next switch locks the paper for 10 minutes.', source, myId(), { tabSwitch: count, action: 'warning' }))
      }
      if (count === 2) {
        const at = now()
        return withEvents(
          patchMe(current, { ...base, lockedAt: at, lockedUntil: new Date(Date.now() + TAB_LOCK_MINUTES * 60_000).toISOString() }),
          event('integrity', `TAB SWITCH #2 — ${myId()} locked for ${TAB_LOCK_MINUTES} minutes`, 'Second switch: the paper is locked for 10 minutes while the timer keeps running. A third switch suspends the exam for officer decision.', source, myId(), { tabSwitch: count, action: 'lock-10min' }),
        )
      }
      if (slice.suspendedAt) return patchMe(current, base)
      return withEvents(
        patchMe(current, { ...base, suspendedAt: now() }),
        event('integrity', `TAB SWITCH #${count} — exam SUSPENDED for ${myId()}, officer decision needed`, 'Third switch: the paper is locked until an exam officer resumes or cancels the attempt. Nothing is cancelled automatically.', source, myId(), { tabSwitch: count, action: 'suspended' }),
      )
    })
  }, [mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Officer cancelled this suspended attempt: close it on the candidate device.
  const myCancellation = state.control.cancellations?.[me ?? '']
  useEffect(() => {
    if (!myCancellation || mine?.phase !== 'exam') return
    mutate((current) => withEvents(
      patchMe(current, { phase: 'submitted', submittedAt: now(), submitReason: 'cancelled' }),
      event('submission', 'Attempt cancelled by exam officer', 'Cancelled after repeated tab switching. Saved answers are kept on record.', mySource(), myId(), { reason: 'cancelled' }),
    ))
  }, [myCancellation, mine?.phase, mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- candidate heartbeat: real HTTP round trip + simulated exam API ----------------

  const myPhase = mine?.phase
  const isCandidateRoute = window.location.pathname.startsWith('/exam')
  // Submitted while offline: keep probing until the outage is closed and queued answers are reconciled.
  const pendingSync = myPhase === 'submitted' && Boolean(mine?.outages.some((outage) => !outage.to) || state.checkpoints.some((c) => c.candidateId === me && c.status === 'queued'))

  useEffect(() => {
    if (!isCandidateRoute || (myPhase !== 'gate' && myPhase !== 'exam' && !pendingSync)) return
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      let httpOk = false
      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 1500)
        const sentAt = performance.now()
        const response = await fetch(`/api/heartbeat?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
        window.clearTimeout(timeout)
        httpOk = response.ok
        if (httpOk) {
          const rtt = performance.now() - sentAt
          rttSamples.current = [...rttSamples.current.slice(-9), rtt]
          rttBaseline.current = [...rttBaseline.current, rtt].sort((x, y) => x - y).slice(0, 10) // best latencies seen = healthy baseline
        }
      } catch {
        httpOk = false
      }
      busy = false
      // The relay is how answers reach the exam office; once it has connected, losing it counts too.
      if (relayRef.current?.readyState === WebSocket.OPEN) relayEverOpen.current = true
      httpOk = httpOk && navigator.onLine && (!relayEverOpen.current || relayRef.current?.readyState === WebSocket.OPEN)
      serverReachableRef.current = httpOk
      const tickAt = now()
      setServerReachable(httpOk)
      const id = myId()
      const slice = stateRef.current.candidates[id]
      if (slice && slice.phase === 'gate' && httpOk && Date.now() - Date.parse(slice.lastHeartbeatAt ?? '0') > 1500) {
        mutate((latest) => patchSlice(latest, id, { lastHeartbeatAt: tickAt })) // lets the Control Tower see a PC go silent at the gate
      }
      const syncing = slice?.phase === 'submitted'
      if (!slice || (slice.phase !== 'exam' && !syncing) || (slice.deviceId && slice.deviceId !== deviceId)) return
      const ok = httpOk && apiReachable(stateRef.current, id)
      // Two consecutive failures before declaring an outage: a slow first request on a cold load is not one.
      failStreak.current = ok ? 0 : failStreak.current + 1
      if (!ok) missedAt.current = [...missedAt.current.filter((time) => Date.now() - time < 300_000), Date.now()]
      if (ok && !syncing && Date.now() - lastTelemetry.current > 10_000) {
        lastTelemetry.current = Date.now()
        void collectTelemetry(rttSamples.current, rttBaseline.current, missedAt.current).then((telemetry) => mutate((latest) => patchSlice(latest, id, { telemetry })))
      }
      if (!ok && !failStart.current) failStart.current = tickAt
      if (ok) failStart.current = undefined
      const open = slice.outages.find((outage) => !outage.to)
      const at = tickAt
      const lastGood = lastGoodRef.current
      if (ok) lastGoodRef.current = at
      const queuedNow = stateRef.current.checkpoints.some((checkpoint) => checkpoint.candidateId === id && checkpoint.status === 'queued')
      if (ok && !open && queuedNow) {
        // Queued before the outage was confirmed (or submitted offline): reconcile without an outage record.
        mutate((latest) => ({ ...latest, checkpoints: latest.checkpoints.map((checkpoint) => (checkpoint.status === 'queued' && checkpoint.candidateId === id ? { ...checkpoint, status: 'verified' as const, reconciledAt: at } : checkpoint)) }))
      } else if (ok && open) {
        const queued = stateRef.current.checkpoints.filter((checkpoint) => checkpoint.candidateId === id && checkpoint.status === 'queued').length
        const lost = secondsBetween(open.from, at)
        mutate((latest) => {
          const current = latest.candidates[id]
          if (!current) return latest
          return withEvents(
            {
              ...patchSlice(latest, id, { lastHeartbeatAt: at, outages: current.outages.map((outage) => (!outage.to && outage.from === open.from ? { ...outage, to: at } : outage)) }),
              checkpoints: latest.checkpoints.map((checkpoint) => (checkpoint.status === 'queued' && checkpoint.candidateId === id ? { ...checkpoint, status: 'verified' as const, reconciledAt: at } : checkpoint)),
            },
            event('recovery', 'Exam-server heartbeat restored', `Connection back after ${lost}s (from last good heartbeat). ${queued} queued checkpoint(s) reconciled without conflict.`, `Candidate app · ${id}`, id, { lostSeconds: lost, reconciled: queued, from: open.from, to: at }),
          )
        })
      } else if (!ok && !open && !syncing && failStreak.current >= 2) {
        // Measure from the last good tick (≤ 2 s before the first failure).
        const from = lastGood && lastGood >= (slice.startedAt ?? '') ? lastGood : failStart.current ?? at
        const cause = httpOk ? 'exam-api' : navigator.onLine ? 'server-unreachable' : 'browser-offline'
        mutate((latest) => withEvents(
          patchSlice(latest, id, { outages: [...(latest.candidates[id]?.outages ?? []), { from }] }),
          event('heartbeat', 'Exam-server heartbeat lost', cause === 'exam-api' ? 'The exam API rejected this session (service outage).' : cause === 'server-unreachable' ? 'The exam server did not answer the HTTP heartbeat.' : 'The browser reports it is offline (cable/Wi-Fi down).', `Candidate app · ${id}`, id, { cause, lastGoodHeartbeat: from }),
        ))
      } else if (ok && Date.now() - Date.parse(slice.lastHeartbeatAt ?? '0') > 1500) {
        mutate((latest) => patchSlice(latest, id, { lastHeartbeatAt: at }))
      }
    }
    void tick()
    const timer = window.setInterval(tick, HEARTBEAT_MS)
    const onNetwork = () => void tick()
    window.addEventListener('online', onNetwork)
    window.addEventListener('offline', onNetwork)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onNetwork)
      window.removeEventListener('offline', onNetwork)
    }
  }, [isCandidateRoute, myPhase, pendingSync, me, mutate])

  // ---------------- Control Tower actions ----------------

  const setFault = useCallback((fault: keyof ControlSlice['faults'], value: boolean) => {
    mutate((current) => withEvents(
      patchControl(current, { faults: { ...current.control.faults, [fault]: value } }),
      event('incident', `Simulation: answer-save channel disabled ${value ? 'ON' : 'OFF'}`, 'Operator-controlled pre-exam fault for readiness-gate testing.', 'Control Tower · simulation'),
    ))
  }, [mutate])

  const setPaperTamper = useCallback((path: string) => {
    mutate((current) => withEvents(
      patchControl(current, { paperTamper: path }),
      event('incident', path ? `Drill: paper altered in transit on ${path}` : 'Drill: paper tampering stopped', path ? 'The exam server now serves a copy of the paper with two options of T5 swapped to PCs on this path. Each PC must detect it against the authority-signed manifest and refuse entry.' : 'All paths receive the genuine paper again.', 'Control Tower · simulation'),
    ))
  }, [mutate])

  const setCentreMode = useCallback((on: boolean) => {
    mutate((current) => withEvents(
      patchControl(current, { centreMode: on }),
      event('approval', `Exam-centre mode ${on ? 'ON' : 'OFF'}`, on ? 'Camera is optional; an invigilator verifies each candidate at the seat before the timer can start.' : 'Remote-proctored mode: camera, face and fullscreen are required.', OFFICER),
    ))
  }, [mutate])

  // ---------------- invigilator actions (seat-level, at the centre) ----------------

  const verifyIdentity = useCallback((id: string, by: string) => {
    mutate((current) => current.control.verified?.[id] ? current : withEvents(
      patchControl(current, { verified: { ...current.control.verified, [id]: { at: now(), by } } }),
      event('access', `Identity verified at the seat: ${id}`, `${by} matched the admit card and photo ID at ${seatLabel(rosterEntry(id))}.`, by, id, { action: 'identity-verified' }),
    ))
  }, [mutate])

  const approveSeatMove = useCallback((id: string, by: string, reason: string) => {
    mutate((current) => withEvents(
      patchControl(current, { seatMoves: { ...current.control.seatMoves, [id]: now() } }),
      event('approval', `Spare PC approved for ${id}`, `${reason} The candidate may sign in on a spare PC within 15 minutes; saved answers and timer carry over.`, by, id, { action: 'seat-move' }),
    ))
  }, [mutate])

  // A seat-level problem the invigilator saw with their own eyes: corroborating evidence for the officer.
  const invigilatorReport = useCallback((id: string, by: string, kind: 'pc-failure' | 'power-cut' | 'malpractice' | 'other', note: string) => {
    const titles = { 'pc-failure': 'PC failure', 'power-cut': 'Power cut', malpractice: 'Suspected malpractice', other: 'Seat issue' }
    mutate((current) => withEvents(current, event(kind === 'malpractice' ? 'integrity' : 'incident', `INVIGILATOR: ${titles[kind]} at ${seatLabel(rosterEntry(id))} (${id})`, note || 'Reported from the invigilator console.', by, id, { action: 'invigilator-report', report: kind, alert: true })))
  }, [mutate])

  const setPolicy = useCallback((patch: Partial<Pick<ControlSlice, 'thresholdSeconds' | 'graceSeconds'>>) => mutate((current) => patchControl(current, patch)), [mutate])

  // kind 'candidate-network' targets one candidate; 'service-outage' hits every signed-in candidate on a path.
  const injectOutage = useCallback((kind: FaultKind, target: string) => {
    mutate((current) => {
      const affected = kind === 'service-outage'
        ? Object.keys(current.candidates).filter((id) => rosterEntry(id)?.path === target && current.candidates[id].phase !== 'submitted')
        : [target]
      if (!affected.length || affected.some((id) => !apiReachable(current, id))) return current
      const incident: Incident = { id: nextIncidentId(current), kind, servicePath: kind === 'service-outage' ? target : rosterEntry(target)?.path ?? '—', startedAt: now(), affected }
      return withEvents(
        patchControl(current, { incidents: [...current.control.incidents, incident] }),
        event('incident', kind === 'service-outage' ? `${incident.id}: simulated exam-API outage on ${target}` : `${incident.id}: simulated network drop for ${target}`, `${affected.length} session(s) cannot reach the exam API: ${affected.join(', ')}. Local answer persistence stays active.`, 'Control Tower · simulation', undefined, { incident: incident.id, affected: affected.length }),
      )
    })
  }, [mutate])

  const restoreService = useCallback((incidentId: string) => {
    mutate((current) => {
      const incident = current.control.incidents.find((item) => item.id === incidentId)
      if (!incident || incident.restoredAt) return current
      return withEvents(
        patchIncident(current, incident.id, { restoredAt: now() }),
        event('recovery', `${incident.id}: service restored`, `Exam API reachable again after ${secondsBetween(incident.startedAt, now())}s. Waiting for each affected session to report its measured interval.`, 'Recovery Orchestrator', undefined, { incident: incident.id }),
      )
    })
  }, [mutate])

  const decide = useCallback(async (incidentId: string, policy: Policy, reason: string, officer: string, auto = false) => {
    const current = stateRef.current
    const incident = current.control.incidents.find((item) => item.id === incidentId)
    if (!incident?.restoredAt || incident.decision) return
    const analysis = analyseIncident(current, incident)
    if (!analysis.ready) return
    const credits = analysis.credits(policy)
    const at = now()
    const approval = event(
      'approval',
      `${incident.id}: ${policy === 'recover' ? 'recover' : policy === 'protect-time' ? 'protect time' : 'targeted reschedule'} ${auto ? 'auto-applied' : 'approved'}`,
      `${reason} Credits: ${Object.entries(credits).map(([id, seconds]) => `${id} +${seconds}s`).join(', ')}. No marks or misconduct outcomes were changed.`,
      auto ? 'Cohort Remedy Engine · low-stakes auto-apply' : officer,
      undefined,
      { incident: incident.id, policy, recommended: analysis.policy, officer, override: policy !== analysis.policy },
    )
    const sealedAudit = await sealEvents([...current.audit, approval])
    const chain = await verifyChain(current.sessionId, sealedAudit)
    const receipts: Record<string, Receipt> = {}
    for (const id of incident.affected) {
      const slice = current.candidates[id]
      const interval = analysis.intervals[id]
      if (!slice?.startedAt || !interval) continue
      const body: Omit<Receipt, 'hash'> = {
        id: `FR-${incident.id}-${id.replace('EXM-', '')}`,
        candidateId: id,
        candidateName: rosterEntry(id)?.name ?? id,
        incidentId: incident.id,
        interval,
        answersPreserved: Object.values(slice.responses).filter((response) => response.answer !== undefined).length,
        checkpointsPreserved: current.checkpoints.filter((checkpoint) => checkpoint.candidateId === id).length,
        policy,
        creditSeconds: credits[id] ?? 0,
        reason,
        officer: auto ? 'Cohort Remedy Engine (auto, low-stakes)' : officer,
        decidedAt: at,
        eventIds: sealedAudit.map((item) => item.id),
        auditHead: chain.head,
      }
      receipts[id] = { ...body, hash: await sha256(receiptBody(body)) }
    }
    mutate((latest) => {
      const target = latest.control.incidents.find((item) => item.id === incidentId)
      if (!target || target.decision) return latest
      const byId = new Map(sealedAudit.map((item) => [item.id, item]))
      const audit = latest.audit.map((item) => (item.digest ? item : byId.get(item.id) ?? item))
      return withEvents(
        { ...patchIncident(latest, incident.id, { decision: { policy, recommended: analysis.policy, credits, reason, officer, at, auto, receipts } }), audit: [...audit, byId.get(approval.id)!] },
        ...Object.values(receipts).map((receipt) => event('approval', `Fairness Receipt ${receipt.id} issued`, `Sealed over ${receipt.eventIds.length} evidence events. Receipt hash ${receipt.hash.slice(0, 16)}…`, 'Receipt service', receipt.candidateId, { receipt: receipt.id, hash: receipt.hash, head: receipt.auditHead })),
      )
    })
    // The exam server re-verifies each receipt against its own evidence copy before signing it
    // (the watchdog retries any receipt that is still unsigned).
    for (const receipt of Object.values(receipts)) {
      void signReceipt(receipt).then((signature) => signature && mutate((latest) => {
        const target = latest.control.incidents.find((item) => item.id === incidentId)
        const existing = target?.decision?.receipts[receipt.candidateId]
        if (!target?.decision || !existing || existing.hash !== receipt.hash || existing.serverSignature) return latest
        return patchIncident(latest, incidentId, { decision: { ...target.decision, receipts: { ...target.decision.receipts, [receipt.candidateId]: { ...existing, ...signature } } } })
      }))
    }
  }, [mutate])

  const approveAssisted = useCallback((id: string) => {
    mutate((current) => !current.candidates[id]?.assistedRequested || current.control.assistedApproved[id] ? current : withEvents(
      patchControl(current, { assistedApproved: { ...current.control.assistedApproved, [id]: now() } }),
      event('approval', `Assisted entry approved for ${id}`, 'Candidate may enter through the documented alternate path. Marks and eligibility unchanged.', OFFICER, id),
    ))
  }, [mutate])

  // Demo attack: silently edit a recorded event, keeping its old digest.
  const tamper = useCallback((eventId: string) => {
    mutate((current) => ({
      ...current,
      audit: current.audit.map((item) => item.id !== eventId ? item : {
        ...item,
        detail: `${item.detail} [edited]`,
        data: item.data?.answer !== undefined ? { ...item.data, answer: item.data.answer === 'C' ? 'D' : 'C' } : item.data,
        rev: (item.rev ?? 0) + 1,
      }),
    }))
  }, [mutate])

  // Epoch = wall-clock ms, so a reset wins even if this tab has not synced the latest session yet.
  const reset = useCallback(() => write(createState(Math.max(Date.now(), (stateRef.current.epoch ?? 0) + 1))), [write])

  // Officer resets one candidate so they can sign in and take the exam again (evidence of the old attempt stays).
  // Officer announcements to all PCs, one service path, or one candidate.
  const postMessage = useCallback((to: string, text: string) => {
    mutate((current) => withEvents(
      patchControl(current, { messages: [...(current.control.messages ?? []), { id: shortId('msg'), at: now(), to, text }].slice(-50) }),
      event('access', `Announcement to ${to === 'all' ? 'all candidates' : to}`, text, OFFICER, to.startsWith('EXM-') ? to : undefined, { to }),
    ))
  }, [mutate])

  const saveRiskReport = useCallback((riskReport: NonNullable<ControlSlice['riskReport']>) => {
    mutate((current) => withEvents(patchControl(current, { riskReport }), event('approval', 'AI post-exam risk report generated', 'Claude analysed aggregated session metrics (no images, no names) for systemic risks.', 'Analytics', undefined, { model: riskReport.model })))
  }, [mutate])

  const resetCandidate = useCallback((id: string) => {
    mutate((current) => {
      const at = now()
      const without = <T,>(map: Record<string, T> | undefined) => Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => key !== id))
      const candidates = { ...current.candidates }
      delete candidates[id]
      return withEvents(
        {
          ...patchControl(current, {
            resets: { ...current.control.resets, [id]: at },
            assistedApproved: without(current.control.assistedApproved),
            unlocks: without(current.control.unlocks),
            cancellations: without(current.control.cancellations),
            reexams: without(current.control.reexams),
            incidents: current.control.incidents.map((incident) => (!incident.restoredAt && incident.affected.includes(id) ? { ...incident, restoredAt: at } : incident)),
          }),
          candidates,
        },
        event('approval', `Attempt reset for ${id}`, 'Officer cleared this candidate so they can sign in and start again. The previous attempt stays in the evidence vault.', OFFICER, id),
      )
    })
  }, [mutate])

  const liftLock = useCallback((id: string) => {
    mutate((current) => withEvents(patchControl(current, { unlocks: { ...current.control.unlocks, [id]: now() } }), event('approval', `Officer resumed ${id}`, 'Tab-switch lock/suspension lifted after review; the candidate continues with the remaining time.', OFFICER, id)))
  }, [mutate])

  const cancelAttempt = useCallback((id: string) => {
    mutate((current) => withEvents(patchControl(current, { cancellations: { ...current.control.cancellations, [id]: now() } }), event('approval', `Officer cancelled the attempt of ${id}`, 'Cancelled after reviewing repeated tab switching.', OFFICER, id)))
  }, [mutate])

  const setWindow = useCallback((windowMinutes: number) => {
    mutate((current) => withEvents(
      patchControl(current, { windowMinutes }),
      event('release', `Exam window set to ${windowMinutes} min`, `Window now closes at ${new Date(Date.parse(current.createdAt) + windowMinutes * 60_000).toLocaleTimeString('en-IN', { hour12: false })}.`, OFFICER),
    ))
  }, [mutate])

  // Re-exam for exactly one candidate, with a sealed receipt. Nobody else is affected.
  const grantReexam = useCallback(async (id: string, auto: boolean, reason: string, officer: string) => {
    const current = stateRef.current
    const slice = current.candidates[id]
    if (!slice?.report || current.control.reexams?.[id]) return
    const evidence = reexamEvidence(current, id)
    const at = now()
    const approval = event('approval', `Re-exam granted to ${id} only`, `${reason} Evidence: ${evidence.join('; ') || 'officer review'}. No other candidate is affected; no marks changed.`, auto ? 'Cohort Remedy Engine · evidence-backed auto-grant' : officer, id, { reexam: true, auto })
    const sealedAudit = await sealEvents([...current.audit, approval])
    const chain = await verifyChain(current.sessionId, sealedAudit)
    const firstLoss = slice.outages[0]?.from ?? current.audit.find((item) => item.candidateId === id && item.kind === 'release' && item.data?.passed === false)?.at ?? slice.loggedInAt
    const incident = current.control.incidents.find((item) => item.affected.includes(id) && !item.restoredAt)
    const body: Omit<Receipt, 'hash'> = {
      id: `FR-RE-${id.replace('EXM-', '')}`,
      candidateId: id,
      candidateName: rosterEntry(id)?.name ?? id,
      incidentId: incident?.id ?? `RE-${id.replace('EXM-', '')}`,
      interval: { from: firstLoss, to: slice.report.at, seconds: secondsBetween(firstLoss, slice.report.at) },
      answersPreserved: slice.report.answered,
      checkpointsPreserved: current.checkpoints.filter((checkpoint) => checkpoint.candidateId === id).length,
      policy: 'reschedule',
      creditSeconds: 0,
      reason,
      officer: auto ? 'Cohort Remedy Engine (evidence-backed auto-grant)' : officer,
      decidedAt: at,
      eventIds: sealedAudit.map((item) => item.id),
      auditHead: chain.head,
    }
    const receipt: Receipt = { ...body, hash: await sha256(receiptBody(body)) }
    mutate((latest) => {
      if (latest.control.reexams?.[id]) return latest
      const byId = new Map(sealedAudit.map((item) => [item.id, item]))
      const audit = latest.audit.map((item) => (item.digest ? item : byId.get(item.id) ?? item))
      return withEvents(
        { ...patchControl(latest, { reexams: { ...latest.control.reexams, [id]: { status: 'granted', at, auto, officer, reason, evidence, receipt } } }), audit: [...audit, byId.get(approval.id)!] },
        event('approval', `Fairness Receipt ${receipt.id} issued`, `Re-exam receipt sealed over ${receipt.eventIds.length} events. Hash ${receipt.hash.slice(0, 16)}…`, 'Receipt service', id, { receipt: receipt.id, hash: receipt.hash }),
      )
    })
    void signReceipt(receipt).then((signature) => signature && mutate((latest) => {
      const current = latest.control.reexams?.[id]
      return current?.receipt?.hash === receipt.hash && !current.receipt.serverSignature ? patchControl(latest, { reexams: { ...latest.control.reexams, [id]: { ...current, receipt: { ...current.receipt, ...signature } } } }) : latest
    }))
  }, [mutate])

  const rejectReexam = useCallback((id: string, reason: string, officer: string) => {
    mutate((current) => !current.candidates[id]?.report || current.control.reexams?.[id] ? current : withEvents(
      patchControl(current, { reexams: { ...current.control.reexams, [id]: { status: 'rejected', at: now(), auto: false, officer, reason, evidence: reexamEvidence(current, id) } } }),
      event('approval', `Re-exam request from ${id} not granted`, reason, officer, id),
    ))
  }, [mutate])

  // ---------------- Control Tower watchdog (runs in /ops, which acts as the exam server) ----------------

  const isOps = window.location.pathname.startsWith('/ops')
  useEffect(() => {
    if (!isOps) return
    const timer = window.setInterval(() => {
      let current = stateRef.current
      let changed = false
      const nowMs = Date.now()
      const inExam = Object.values(current.candidates).filter((slice) => slice.phase === 'exam')
      const losing = inExam.filter((slice) => slice.outages.some((outage) => !outage.to) || heartbeatAge(slice, nowMs) * 1000 > STALE_MS)
      const platformWide = losing.length >= Math.max(2, Math.ceil(inExam.length / 2))
      // An undecided incident for this candidate that ended moments ago: reuse it for flapping.
      const recentFor = (id: string, at: string) => current.control.incidents.find((incident) => incident.detected && !incident.decision && incident.restoredAt && incident.affected.includes(id) && Date.parse(at) - Date.parse(incident.restoredAt) <= COHORT_WINDOW_MS && Date.parse(at) >= Date.parse(incident.startedAt))
      for (const slice of inExam) {
        const id = slice.candidateId
        const restoredAt = lastRestoreFor(current, id)
        const recentlyRestored = restoredAt && nowMs - Date.parse(restoredAt) < 10_000
        const open = slice.outages.find((outage) => !outage.to && (!restoredAt || outage.from >= restoredAt))
        const stale = heartbeatAge(slice, nowMs) * 1000 > STALE_MS && !recentlyRestored
        const covered = current.control.incidents.some((incident) => !incident.restoredAt && incident.affected.includes(id))
        if ((open || stale) && !covered) {
          const lastSeen = slice.lastHeartbeatAt ?? now()
          const lossAt = open?.from ?? (restoredAt && restoredAt > lastSeen ? restoredAt : lastSeen)
          const path = rosterEntry(id)?.path ?? '—'
          const join = current.control.incidents.find((incident) => incident.detected && !incident.restoredAt && (incident.servicePath === path || incident.platform || platformWide) && Math.abs(Date.parse(incident.startedAt) - Date.parse(lossAt)) <= COHORT_WINDOW_MS)
          const reason = open ? 'The candidate browser reported losing the exam server.' : `No heartbeat for ${heartbeatAge(slice, nowMs)}s (tab closed, crash, power or network loss).`
          const recent = recentFor(id, lossAt)
          if (recent) {
            current = withEvents(patchIncident(current, recent.id, { restoredAt: undefined }), event('incident', `${recent.id}: reopened — connection dropped again for ${id}`, `${reason} Repeated drops within 30 s are tracked as one incident.`, 'Heartbeat watchdog', id, { incident: recent.id }))
          } else if (join) {
            const crossPath = join.servicePath !== path || join.platform
            current = withEvents(
              patchIncident(current, join.id, { affected: [...join.affected, id], kind: 'service-outage', ...(crossPath ? { platform: true, servicePath: 'all paths' } : {}) }),
              event('incident', `${join.id}: ${id} joined correlated heartbeat loss${crossPath ? ' (platform-wide)' : ` on ${path}`}`, reason, 'Heartbeat watchdog', id, { incident: join.id }),
            )
          } else {
            const incident: Incident = { id: nextIncidentId(current), kind: 'candidate-network', servicePath: path, startedAt: lossAt, affected: [id], detected: true }
            current = withEvents(patchControl(current, { incidents: [...current.control.incidents, incident] }), event('incident', `${incident.id}: heartbeat loss detected for ${id}`, reason, 'Heartbeat watchdog', id, { incident: incident.id }))
          }
          changed = true
        }
      }
      // Short or flapping drops can open and close between watchdog ticks: give each closed,
      // uncovered interval its own already-restored incident so it still gets a remedy.
      for (const slice of Object.values(current.candidates)) {
        const id = slice.candidateId
        for (const outage of slice.outages) {
          if (!outage.to) continue
          const covered = current.control.incidents.some((incident) => incident.affected.includes(id) && incident.startedAt <= outage.to! && (incident.restoredAt ?? '9') >= outage.from)
          if (covered) continue
          const recent = recentFor(id, outage.from)
          if (recent) {
            current = patchIncident(current, recent.id, { restoredAt: outage.to > recent.restoredAt! ? outage.to : recent.restoredAt })
            changed = true
            continue
          }
          const incident: Incident = { id: nextIncidentId(current), kind: 'candidate-network', servicePath: rosterEntry(id)?.path ?? '—', startedAt: outage.from, restoredAt: outage.to, affected: [id], detected: true }
          current = withEvents(
            patchControl(current, { incidents: [...current.control.incidents, incident] }),
            event('incident', `${incident.id}: short connection loss for ${id}`, `The candidate browser recorded a ${secondsBetween(outage.from, outage.to)}s outage that closed between watchdog checks.`, 'Heartbeat watchdog', id, { incident: incident.id }),
          )
          changed = true
        }
      }
      for (const incident of openIncidents(current)) {
        if (!incident.detected) continue
        const healthy = incident.affected.every((id) => {
          const slice = current.candidates[id]
          return !slice || slice.phase !== 'exam' || (!slice.outages.some((outage) => !outage.to) && heartbeatAge(slice, nowMs) * 1000 <= STALE_MS)
        })
        if (healthy) {
          current = withEvents(patchIncident(current, incident.id, { restoredAt: now() }), event('recovery', `${incident.id}: heartbeat resumed for ${incident.affected.join(', ')}`, 'Sessions reachable again; measured intervals are available to the remedy engine.', 'Heartbeat watchdog', undefined, { incident: incident.id }))
          changed = true
        }
      }
      if (changed) write(current)
      // Self-healing: any receipt still missing the server signature gets (re)submitted for signing.
      for (const incident of current.control.incidents) {
        for (const receipt of Object.values(incident.decision?.receipts ?? {})) {
          if (receipt.serverSignature || nowMs - (signAttempts.current.get(receipt.id) ?? 0) < 8000) continue
          signAttempts.current.set(receipt.id, nowMs)
          void signReceipt(receipt).then((signature) => signature && mutate((latest) => {
            const target = latest.control.incidents.find((item) => item.id === incident.id)
            const existing = target?.decision?.receipts[receipt.candidateId]
            if (!target?.decision || !existing || existing.hash !== receipt.hash || existing.serverSignature) return latest
            return patchIncident(latest, incident.id, { decision: { ...target.decision, receipts: { ...target.decision.receipts, [receipt.candidateId]: { ...existing, ...signature } } } })
          }))
        }
      }
      for (const [id, item] of Object.entries(current.control.reexams ?? {})) {
        const receipt = item.receipt
        if (!receipt || receipt.serverSignature || nowMs - (signAttempts.current.get(receipt.id) ?? 0) < 8000) continue
        signAttempts.current.set(receipt.id, nowMs)
        void signReceipt(receipt).then((signature) => signature && mutate((latest) => {
          const existing = latest.control.reexams?.[id]
          return existing?.receipt?.hash === receipt.hash && !existing.receipt.serverSignature ? patchControl(latest, { reexams: { ...latest.control.reexams, [id]: { ...existing, receipt: { ...existing.receipt, ...signature } } } }) : latest
        }))
      }
      // "Could not take the exam" reports: auto-grant a re-exam for that candidate only when the
      // platform's own records corroborate it; otherwise leave it for an officer.
      for (const slice of Object.values(current.candidates)) {
        if (!slice.report || current.control.reexams?.[slice.candidateId]) continue
        if (reexamEvidence(current, slice.candidateId, true).length) {
          void grantReexam(slice.candidateId, true, 'The platform recorded that this candidate lost the exam session and could not complete it before the window closed.', OFFICER)
        }
      }
      for (const incident of current.control.incidents) {
        if (incident.affected.every((id) => current.control.reexams?.[id]?.status === 'granted')) continue
        if (!incident.restoredAt || incident.decision || nowMs - Date.parse(incident.restoredAt) < QUIET_MS) continue
        const analysis = analyseIncident(current, incident)
        if (analysis.ready && !analysis.needsOfficer) void decide(incident.id, analysis.policy, analysis.reasons.join(' '), OFFICER, true)
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [isOps, write, decide, grantReexam])

  const otherDevice = Boolean(mine?.deviceId && mine.deviceId !== deviceId && mine.phase !== 'submitted')

  return {
    state, me, mine, otherDevice, syncConnected, serverReachable,
    login, fetchCandidate, logout, acceptInstructions, recordGate, startExam, setLang, goTo, setMarked, updateResponse, saveAnswer, submit,
    recordSignal, addWarning, setAiStatus, reportMedia, requestAssisted, reportAffected, tabSwitch, acknowledge,
    setWindow, grantReexam, rejectReexam, liftLock, cancelAttempt, resetCandidate, postMessage, saveRiskReport, setFault, setPaperTamper, setCentreMode, verifyIdentity, approveSeatMove, invigilatorReport, setPolicy, injectOutage, restoreService, decide, approveAssisted, tamper, reset,
  }
}

export type ExamApi = ReturnType<typeof useExam>
