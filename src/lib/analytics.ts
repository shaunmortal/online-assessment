// Pure analytics over the shared exam state: early warning, pattern detection, reconciliation,
// exam-level decision support and systemic risk. Everything here is review-only evidence.
import { offlineSeconds, secondsBetween, type CandidateSlice, type ExamState } from './core'
import { QUESTIONS, rosterEntry } from '../data/paper'

const MIN = 60_000

// ---------- early warning (prediction) ----------

export interface Risk { score: number; level: 'ok' | 'watch' | 'high'; reasons: string[] }

// Likelihood that this PC drops out soon, from signals that precede an outage.
export function deviceRisk(slice: CandidateSlice, at = Date.now()): Risk {
  const t = slice.telemetry
  const reasons: string[] = []
  let score = 0
  if (t?.battery && !t.battery.charging && t.battery.level <= 35) {
    score += t.battery.level <= 15 ? 45 : 25
    reasons.push(`battery ${t.battery.level}% and not charging`)
  }
  if (t && t.baselineRttMs > 0 && t.rttMs >= Math.max(300, t.baselineRttMs * 3)) {
    score += 25
    reasons.push(`heartbeat latency ${t.rttMs} ms vs ${t.baselineRttMs} ms baseline`)
  } else if (t && t.rttMs >= 800) {
    score += 25
    reasons.push(`heartbeat latency ${t.rttMs} ms`)
  }
  if (t && t.jitterMs >= 250) {
    score += 10
    reasons.push(`unstable latency (±${t.jitterMs} ms)`)
  }
  if (t?.missed) {
    score += Math.min(30, t.missed * 10)
    reasons.push(`${t.missed} missed heartbeat(s) in 5 min`)
  }
  if (t?.net?.type === 'slow-2g' || t?.net?.type === '2g') {
    score += 30
    reasons.push(`network reported as ${t.net.type}`)
  } else if (t?.net?.type === '3g') {
    score += 10
    reasons.push('network reported as 3g')
  }
  const recent = slice.outages.filter((outage) => at - Date.parse(outage.to ?? new Date(at).toISOString()) < 10 * MIN).length
  if (recent) {
    score += Math.min(30, recent * 15)
    reasons.push(`${recent} connection drop(s) in the last 10 min`)
  }
  if (t && at - Date.parse(t.at) > MIN && slice.phase === 'exam') reasons.push('telemetry is stale')
  score = Math.min(100, score)
  return { score, level: score >= 50 ? 'high' : score >= 25 ? 'watch' : 'ok', reasons }
}

export interface PathHealth { path: string; centre: string; sessions: number; meanRtt: number; baselineRtt: number; risky: number; incidents: number; forecast: 'stable' | 'degrading' | 'outage-likely'; reasons: string[] }

// A service path is degrading when several of its PCs show rising latency or missed heartbeats together.
export function pathHealth(state: ExamState, at = Date.now()): PathHealth[] {
  const groups = new Map<string, CandidateSlice[]>()
  for (const slice of Object.values(state.candidates)) {
    if (slice.phase !== 'exam') continue
    const path = rosterEntry(slice.candidateId)?.path ?? '—'
    groups.set(path, [...(groups.get(path) ?? []), slice])
  }
  return [...groups.entries()].map(([path, slices]) => {
    const withT = slices.filter((slice) => slice.telemetry)
    const meanRtt = Math.round(withT.reduce((sum, slice) => sum + slice.telemetry!.rttMs, 0) / Math.max(1, withT.length))
    const baselineRtt = Math.round(withT.reduce((sum, slice) => sum + slice.telemetry!.baselineRttMs, 0) / Math.max(1, withT.length))
    const missing = slices.filter((slice) => (slice.telemetry?.missed ?? 0) > 0).length
    const risky = slices.filter((slice) => deviceRisk(slice, at).level !== 'ok').length
    const incidents = state.control.incidents.filter((incident) => incident.servicePath === path || incident.affected.some((id) => rosterEntry(id)?.path === path)).length
    const reasons: string[] = []
    if (baselineRtt && meanRtt >= Math.max(250, baselineRtt * 3)) reasons.push(`latency ${meanRtt} ms is ${Math.round(meanRtt / baselineRtt)}× baseline`)
    if (missing >= 2) reasons.push(`${missing} PCs missed heartbeats recently`)
    if (risky >= Math.max(2, Math.ceil(slices.length / 2))) reasons.push(`${risky}/${slices.length} PCs at elevated risk`)
    const forecast = reasons.length >= 2 ? 'outage-likely' : reasons.length === 1 ? 'degrading' : 'stable'
    return { path, centre: rosterEntry(slices[0].candidateId)?.centre ?? '—', sessions: slices.length, meanRtt, baselineRtt, risky, incidents, forecast, reasons }
  })
}

// ---------- suspicious patterns across candidates ----------

export interface PatternFlag { kind: 'collusion' | 'same-code' | 'rapid-correct'; candidates: string[]; detail: string }

export function patternFlags(state: ExamState): PatternFlag[] {
  const flags: PatternFlag[] = []
  const slices = Object.values(state.candidates).filter((slice) => slice.startedAt)
  const mcqs = QUESTIONS.filter((question) => question.type === 'mcq')
  const letter = (index: number) => String.fromCharCode(65 + index)
  // Identical WRONG answers are the classic collusion signal (identical right answers are expected).
  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; j += 1) {
      const a = slices[i]
      const b = slices[j]
      let bothWrong = 0
      let sameWrong = 0
      for (const question of mcqs) {
        if (question.type !== 'mcq') continue
        const x = a.responses[question.id]?.answer
        const y = b.responses[question.id]?.answer
        const key = letter(question.key)
        if (!x || !y || x === key || y === key) continue
        bothWrong += 1
        if (x === y) sameWrong += 1
      }
      if (sameWrong >= 3 && sameWrong / bothWrong >= 0.6) {
        flags.push({ kind: 'collusion', candidates: [a.candidateId, b.candidateId], detail: `${sameWrong} identical wrong answers out of ${bothWrong} questions both got wrong` })
      }
    }
  }
  // Identical submitted code (by content hash) between different candidates.
  const codeBy = new Map<string, string[]>()
  for (const checkpoint of state.checkpoints) {
    const hash = /^code#([0-9A-F]{12})/.exec(checkpoint.answer)?.[1]
    if (!hash) continue
    const key = `${checkpoint.question}:${hash}`
    const list = codeBy.get(key) ?? []
    if (!list.includes(checkpoint.candidateId)) codeBy.set(key, [...list, checkpoint.candidateId])
  }
  for (const [key, ids] of codeBy) if (ids.length >= 2) flags.push({ kind: 'same-code', candidates: ids, detail: `identical code submitted for ${key.split(':')[0]}` })
  // Long streaks of correct answers each given within 4 s of the previous one.
  for (const slice of slices) {
    const own = state.checkpoints.filter((c) => c.candidateId === slice.candidateId && c.at >= slice.loggedInAt).sort((x, y) => x.sequence - y.sequence)
    let streak = 0
    let best = 0
    for (let k = 1; k < own.length; k += 1) {
      const question = mcqs.find((q) => q.id === own[k].question)
      const fast = Date.parse(own[k].at) - Date.parse(own[k - 1].at) < 4000
      const correct = question?.type === 'mcq' && own[k].answer === letter(question.key)
      streak = fast && correct ? streak + 1 : 0
      best = Math.max(best, streak)
    }
    if (best >= 5) flags.push({ kind: 'rapid-correct', candidates: [slice.candidateId], detail: `${best} correct answers in a row, each under 4 s apart` })
  }
  return flags
}

// ---------- reconciliation & validation of responses ----------

export interface ReconcileCheck { label: string; ok: boolean; detail: string }

export function reconcile(state: ExamState, id: string): { ok: boolean; checks: ReconcileCheck[] } {
  const slice = state.candidates[id]
  if (!slice) return { ok: true, checks: [] }
  const own = state.checkpoints.filter((c) => c.candidateId === id && c.at >= slice.loggedInAt).sort((a, b) => a.sequence - b.sequence)
  const checks: ReconcileCheck[] = []
  const sequences = own.map((c) => c.sequence)
  const expected = new Set(sequences)
  const gaps = sequences.length ? Array.from({ length: Math.max(...sequences) - Math.min(...sequences) + 1 }, (_, i) => Math.min(...sequences) + i).filter((n) => !expected.has(n)) : []
  const dupes = sequences.filter((n, i) => sequences.indexOf(n) !== i)
  checks.push({ label: 'Checkpoint sequence', ok: !gaps.length && !dupes.length, detail: gaps.length || dupes.length ? `missing #${gaps.join(', #') || '—'}; duplicate #${dupes.join(', #') || '—'}` : `${own.length} checkpoints, contiguous` })
  const badFormat = own.filter((c) => !/^([A-D]|\(cleared\)|code#[0-9A-F]{12} \(\d+ chars\)|\d+\/\d+ tests.*|code saved \(not evaluated\))$/.test(c.answer))
  checks.push({ label: 'Answer format', ok: !badFormat.length, detail: badFormat.length ? `${badFormat.length} malformed answer(s)` : 'every answer is a valid option, clear, or code hash' })
  const unknown = own.filter((c) => !QUESTIONS.some((q) => q.id === c.question))
  checks.push({ label: 'Questions exist in paper', ok: !unknown.length, detail: unknown.length ? `unknown: ${unknown.map((c) => c.question).join(', ')}` : 'all answers map to this paper' })
  const outside = own.filter((c) => (slice.startedAt && c.at < new Date(Date.parse(slice.startedAt) - 2000).toISOString()) || (slice.submittedAt && c.at > new Date(Date.parse(slice.submittedAt) + 5000).toISOString()))
  checks.push({ label: 'Inside the exam window', ok: !outside.length, detail: outside.length ? `${outside.length} answer(s) time-stamped before start or after submit` : 'all answers between start and submit' })
  const order = own.filter((c, i) => i > 0 && c.at < own[i - 1].at)
  checks.push({ label: 'Time order', ok: !order.length, detail: order.length ? `${order.length} checkpoint(s) earlier than the previous one (clock moved back)` : 'timestamps increase with sequence' })
  // Offline answers must fall inside an offline interval the platform itself measured (clock-tamper check).
  const queued = own.filter((c) => c.reconciledAt || c.status === 'queued')
  const suspicious = queued.filter((c) => !slice.outages.some((o) => c.at >= new Date(Date.parse(o.from) - 3000).toISOString() && c.at <= new Date(Date.parse(o.to ?? new Date().toISOString()) + 3000).toISOString()))
  checks.push({ label: 'Offline answers inside measured offline time', ok: !suspicious.length, detail: queued.length ? suspicious.length ? `${suspicious.length} offline answer(s) claim a time outside any measured outage` : `${queued.length} offline answer(s), all inside measured outages` : 'no offline answers' })
  const mismatched = QUESTIONS.filter((q) => {
    const last = [...own].reverse().find((c) => c.question === q.id)
    const answer = slice.responses[q.id]?.answer
    if (!last) return answer !== undefined && q.type === 'mcq'
    if (q.type === 'coding') return false
    return (last.answer === '(cleared)' ? undefined : last.answer) !== answer
  })
  checks.push({ label: 'Final answers match the log', ok: !mismatched.length, detail: mismatched.length ? `differs for ${mismatched.map((q) => q.id).join(', ')}` : 'final answer sheet equals the last checkpoint for every question' })
  const pending = own.filter((c) => c.status === 'queued').length
  checks.push({ label: 'All offline answers synced', ok: !pending, detail: pending ? `${pending} still queued on the device` : 'nothing waiting' })
  return { ok: checks.every((check) => check.ok), checks }
}

// ---------- exam-level decision support ----------

export interface ExamDecision { verdict: 'no-reconduct' | 'targeted' | 'reconduct-cohort'; headline: string; reasons: string[]; affected: string[]; started: number }

export function examDecision(state: ExamState, at = Date.now()): ExamDecision {
  const started = Object.values(state.candidates).filter((slice) => slice.startedAt)
  const lostBy = new Map<string, number>()
  for (const incident of state.control.incidents) {
    for (const id of incident.affected) {
      const slice = state.candidates[id]
      if (!slice?.startedAt) continue
      const window = secondsBetween(incident.startedAt, incident.restoredAt ?? new Date(at).toISOString())
      const offline = offlineSeconds(slice, at, { from: incident.startedAt, to: incident.restoredAt ?? new Date(at).toISOString() })
      lostBy.set(id, (lostBy.get(id) ?? 0) + Math.max(0, window - offline)) // time offline answering could NOT cover
    }
  }
  const reexams = Object.entries(state.control.reexams ?? {}).filter(([, item]) => item.status === 'granted').map(([id]) => id)
  const rescheduled = state.control.incidents.filter((incident) => incident.decision?.policy === 'reschedule').flatMap((incident) => incident.affected)
  const affected = [...new Set([...lostBy.entries()].filter(([, seconds]) => seconds >= state.control.thresholdSeconds).map(([id]) => id).concat(reexams, rescheduled))]
  const share = started.length ? affected.length / started.length : 0
  const reasons = [
    `${started.length} candidate(s) started; ${state.control.incidents.length} incident(s) recorded.`,
    `${affected.length} candidate(s) lost ≥ ${state.control.thresholdSeconds}s that offline answering could not cover, or were granted a re-exam.`,
    `Offline-first kept ${started.filter((slice) => slice.outages.length).length} disconnected candidate(s) answering during drops.`,
  ]
  if (share >= 0.5 && started.length >= 2) return { verdict: 'reconduct-cohort', headline: `Re-conduct recommended for the cohort: ${Math.round(share * 100)}% of candidates were materially affected.`, reasons, affected, started: started.length }
  if (affected.length) return { verdict: 'targeted', headline: `Targeted re-exam for ${affected.length} candidate(s) only — no need to re-conduct the whole exam.`, reasons, affected, started: started.length }
  return { verdict: 'no-reconduct', headline: 'No re-conduct needed: every disruption was absorbed by offline answering or a recorded remedy.', reasons, affected, started: started.length }
}

// ---------- systemic risk analytics ----------

export interface CentreStats { centre: string; path: string; candidates: number; started: number; incidents: number; offlineMinutes: number; drops: number; integrity: number; aiFlags: number; reliability: number }

export function systemicStats(state: ExamState, at = Date.now()) {
  const byPath = new Map<string, CentreStats>()
  for (const slice of Object.values(state.candidates)) {
    const entry = rosterEntry(slice.candidateId)
    const path = entry?.path ?? '—'
    const stats = byPath.get(path) ?? { centre: entry?.centre ?? '—', path, candidates: 0, started: 0, incidents: 0, offlineMinutes: 0, drops: 0, integrity: 0, aiFlags: 0, reliability: 100 }
    stats.candidates += 1
    if (slice.startedAt) stats.started += 1
    stats.offlineMinutes += offlineSeconds(slice, at) / 60
    stats.drops += slice.outages.length
    stats.integrity += state.audit.filter((event) => event.candidateId === slice.candidateId && event.kind === 'integrity').length
    stats.aiFlags += state.audit.filter((event) => event.candidateId === slice.candidateId && event.kind === 'ai' && event.data?.risk !== undefined && event.data.risk !== 'none').length
    byPath.set(path, stats)
  }
  for (const incident of state.control.incidents) {
    const paths = new Set(incident.affected.map((id) => rosterEntry(id)?.path ?? '—'))
    for (const path of paths) { const stats = byPath.get(path); if (stats) stats.incidents += 1 }
  }
  const centres = [...byPath.values()].map((stats) => ({
    ...stats,
    offlineMinutes: Math.round(stats.offlineMinutes * 10) / 10,
    // 100 = no drops; each drop and each offline minute per started candidate costs reliability.
    reliability: Math.max(0, Math.round(100 - (stats.drops * 8 + stats.offlineMinutes * 10 + stats.incidents * 5) / Math.max(1, stats.started))),
  })).sort((a, b) => a.reliability - b.reliability)
  // Incidents per 5-minute slot since the session started.
  const slots = new Map<number, number>()
  for (const incident of state.control.incidents) {
    const slot = Math.floor((Date.parse(incident.startedAt) - Date.parse(state.createdAt)) / (5 * MIN))
    slots.set(slot, (slots.get(slot) ?? 0) + 1)
  }
  const timeline = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([slot, count]) => ({ fromMinute: slot * 5, count }))
  const causes: Record<string, number> = {}
  for (const event of state.audit) if (event.kind === 'heartbeat' && typeof event.data?.cause === 'string') causes[event.data.cause] = (causes[event.data.cause] ?? 0) + 1
  return { centres, timeline, causes }
}
