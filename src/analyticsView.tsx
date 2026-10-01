import { useEffect, useState } from 'react'
import { Activity, Bot, Database, Download, FileText, Gauge, HardDrive, Loader2, Megaphone, Printer, ShieldCheck, Upload, Zap } from 'lucide-react'
import { verifyChain, type ChainReport, type ExamState, type Incident } from './lib/core'
import { deviceRisk, examDecision, pathHealth, patternFlags, reconcile, systemicStats, type AnswerKey } from './lib/analytics'
import { BLUEPRINT, ROSTER, rosterEntry } from './data/paper'
import { analyseIncident, sessionReport, type ExamApi } from './state'
import { Brand, fmtClock, fmtTime, officerHeaders, Pill, policyLabel, useNow } from './ui'

// ---------------------------------------------------------------- infrastructure

interface Health {
  uptimeSeconds: number; eventLoopLagMs: number; memoryMb: number; relayClients: number; relayMessagesPerMinute: number
  storage: { lastPersistAt?: string; error?: string; evidenceEvents: number; file: string }
  signing: { keyId: string }
  proctor: { enabled: boolean; calls: number; errors: number; totalMs: number; lastError?: string }
}

export function InfraPanel({ api }: { api: ExamApi }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [down, setDown] = useState(false)
  const [history, setHistory] = useState<number[]>([])
  const [restoreMsg, setRestoreMsg] = useState('')

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store', headers: officerHeaders() })
        const body = (await response.json()) as Health
        if (!alive) return
        setHealth(body)
        setDown(false)
        setHistory((list) => [...list.slice(-29), body.eventLoopLagMs])
      } catch {
        if (alive) setDown(true)
      }
    }
    void poll()
    const timer = window.setInterval(poll, 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  const restore = async (file?: File) => {
    if (!file) return
    try {
      const response = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', ...officerHeaders() }, body: await file.text() })
      const body = await response.json()
      setRestoreMsg(response.ok ? `Restored session ${body.sessionId}: ${body.candidates} candidates, ${body.events} events. All PCs resync automatically.` : body.error)
    } catch {
      setRestoreMsg('Restore failed: server unreachable')
    }
  }

  const lagMax = Math.max(50, ...history)
  const sessions = Object.values(api.state.candidates).filter((slice) => slice.phase === 'exam')
  const avgRtt = sessions.filter((slice) => slice.telemetry).reduce((sum, slice, _, list) => sum + slice.telemetry!.rttMs / list.length, 0)

  return (
    <section className="panel" id="infra">
      <div className="panel-head"><h2>Infrastructure &amp; recovery</h2><small>Live server health every 5 s. State and the evidence log are written to disk, so a restarted server recovers without any browser.</small></div>
      {down && <p className="error-text">Exam server is not answering /api/health — candidates keep working offline and will sync when it returns.</p>}
      {health && (
        <div className="infra-grid">
          <Stat icon={<Activity size={16} />} label="Server uptime" value={fmtClock(health.uptimeSeconds)} tone="good" />
          <Stat icon={<Gauge size={16} />} label="Event-loop lag" value={`${health.eventLoopLagMs} ms`} tone={health.eventLoopLagMs > 200 ? 'bad' : health.eventLoopLagMs > 50 ? 'warn' : 'good'}>
            <svg className="spark" viewBox={`0 0 ${Math.max(1, history.length - 1) * 6} 24`} preserveAspectRatio="none" aria-hidden="true">
              <polyline points={history.map((value, i) => `${i * 6},${24 - (value / lagMax) * 22}`).join(' ')} />
            </svg>
          </Stat>
          <Stat icon={<HardDrive size={16} />} label="Memory" value={`${health.memoryMb} MB`} tone={health.memoryMb > 800 ? 'warn' : 'good'} />
          <Stat icon={<Zap size={16} />} label="Relay" value={`${health.relayClients} sockets`} detail={`${health.relayMessagesPerMinute} msgs/min`} tone="good" />
          <Stat icon={<Activity size={16} />} label="Mean heartbeat RTT" value={`${Math.round(avgRtt)} ms`} detail={`${sessions.length} in-exam PCs`} tone={avgRtt > 500 ? 'warn' : 'good'} />
          <Stat icon={<Database size={16} />} label="Durable storage" value={health.storage.error ? 'ERROR' : `${health.storage.evidenceEvents} events`} detail={health.storage.error ?? `saved ${fmtTime(health.storage.lastPersistAt)} · ${health.storage.file}`} tone={health.storage.error ? 'bad' : 'good'} />
          <Stat icon={<Bot size={16} />} label="AI proctor" value={health.proctor.enabled ? `${health.proctor.calls} frames` : 'off'} detail={health.proctor.enabled ? `${health.proctor.errors} errors · avg ${health.proctor.calls ? Math.round(health.proctor.totalMs / health.proctor.calls) : 0} ms${health.proctor.lastError ? ` · ${health.proctor.lastError}` : ''}` : 'set ANTHROPIC_API_KEY'} tone={health.proctor.errors ? 'warn' : 'good'} />
          <Stat icon={<ShieldCheck size={16} />} label="Receipt signing key" value={health.signing.keyId} detail="ECDSA P-256" tone="good" />
        </div>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={() => void fetch('/api/backup', { headers: officerHeaders() }).then((r) => r.blob()).then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'examshield-backup.json'; a.click(); URL.revokeObjectURL(url) })}><Download size={13} /> Download full backup</button>
        <label className="btn small file-btn"><Upload size={13} /> Restore from backup<input type="file" accept="application/json" onChange={(e) => void restore(e.target.files?.[0])} /></label>
        <a className="btn small" href="/report" target="_blank" rel="noreferrer"><FileText size={13} /> Exam report (print / PDF)</a>
        {restoreMsg && <small>{restoreMsg}</small>}
      </div>
    </section>
  )
}

function Stat({ icon, label, value, detail, tone, children }: { icon: React.ReactNode; label: string; value: string; detail?: string; tone: 'good' | 'warn' | 'bad'; children?: React.ReactNode }) {
  return <div className={`stat ${tone}`}>{icon}<span><small>{label}</small><b>{value}</b>{detail && <em>{detail}</em>}{children}</span></div>
}

// ---------------------------------------------------------------- early warning

export function EarlyWarnings({ state, nowMs }: { state: ExamState; nowMs: number }) {
  const paths = pathHealth(state, nowMs)
  const risky = Object.values(state.candidates).filter((slice) => slice.phase === 'exam').map((slice) => ({ slice, risk: deviceRisk(slice, nowMs) })).filter((item) => item.risk.level !== 'ok').sort((a, b) => b.risk.score - a.risk.score)
  return (
    <section className="panel" id="warnings">
      <div className="panel-head"><h2>Early warning</h2><small>Predicts drop-outs before they happen from latency trends, missed heartbeats, battery and network quality reported by each PC.</small></div>
      <div className="path-grid">
        {paths.map((path) => (
          <div key={path.path} className={`path-card ${path.forecast}`}>
            <b>{path.centre} · {path.path}</b>
            <Pill tone={path.forecast === 'stable' ? 'good' : path.forecast === 'degrading' ? 'warn' : 'bad'}>{path.forecast === 'stable' ? 'Stable' : path.forecast === 'degrading' ? 'Degrading' : 'Outage likely'}</Pill>
            <small>{path.sessions} PCs · RTT {path.meanRtt} ms (baseline {path.baselineRtt} ms) · {path.incidents} incident(s)</small>
            {path.reasons.map((reason) => <small key={reason}>• {reason}</small>)}
          </div>
        ))}
        {!paths.length && <p className="muted">No PCs in the exam yet.</p>}
      </div>
      {risky.length > 0 && (
        <ul className="evidence">
          {risky.map(({ slice, risk }) => <li key={slice.candidateId}><b>{rosterEntry(slice.candidateId)?.name} ({slice.candidateId})</b> — risk {risk.score}: {risk.reasons.join('; ')}</li>)}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- AI officer co-pilot

interface Advice { assessment: string; recommendation: string; confidence: string; key_evidence: string[]; cautions: string[] }

export function incidentContext(state: ExamState, incident: Incident) {
  const analysis = analyseIncident(state, incident)
  return {
    incident: { id: incident.id, kind: incident.kind, detectedByWatchdog: Boolean(incident.detected), platformWide: Boolean(incident.platform), startedAt: incident.startedAt, restoredAt: incident.restoredAt },
    engine: { scope: analysis.scope, lostSeconds: analysis.lostSeconds, recommendation: analysis.policy, reasons: analysis.reasons, graceSeconds: state.control.graceSeconds, rescheduleThresholdSeconds: state.control.thresholdSeconds },
    candidates: incident.affected.map((id) => {
      const slice = state.candidates[id]
      const window = { from: incident.startedAt, to: incident.restoredAt ?? new Date().toISOString() }
      const during = state.audit.filter((event) => event.candidateId === id && event.at >= window.from && event.at <= window.to)
      return {
        candidate: id,
        measuredInterval: analysis.intervals[id] ?? null,
        offlineAnswersSynced: state.checkpoints.filter((c) => c.candidateId === id && c.reconciledAt && c.at >= window.from && c.at <= window.to).length,
        integritySignalsDuringIncident: during.filter((event) => event.kind === 'integrity' || event.kind === 'ai').map((event) => event.title),
        deviceTelemetry: slice?.telemetry ?? null,
        candidateConfirmations: slice?.acknowledgements ?? null,
        phase: slice?.phase,
      }
    }),
  }
}

export function CopilotBox({ state, incident }: { state: ExamState; incident: Incident }) {
  const [advice, setAdvice] = useState<{ result: Advice; ms: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json', ...officerHeaders() }, body: JSON.stringify({ context: incidentContext(state, incident) }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setAdvice(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Co-pilot unavailable')
    }
    setBusy(false)
  }
  return (
    <div className="copilot">
      {!advice && <button className="btn small" onClick={() => void ask()} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : <Bot size={13} />} {busy ? 'Claude is reading the evidence…' : 'Ask AI co-pilot'}</button>}
      {error && <small className="bad">{error}</small>}
      {advice && (
        <div className="copilot-answer">
          <small>AI co-pilot · {advice.ms} ms · advice only, the officer decides</small>
          <p>{advice.result.assessment}</p>
          <b>Suggests: {advice.result.recommendation} <Pill tone={advice.result.confidence === 'high' ? 'good' : advice.result.confidence === 'medium' ? 'warn' : 'neutral'}>{advice.result.confidence} confidence</Pill></b>
          <ul>{advice.result.key_evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          {advice.result.cautions.length > 0 && <ul className="cautions">{advice.result.cautions.map((item) => <li key={item}>Check: {item}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- announcements

export function Announcements({ api }: { api: ExamApi }) {
  const [to, setTo] = useState('all')
  const [text, setText] = useState('')
  const recent = [...(api.state.control.messages ?? [])].reverse().slice(0, 6)
  const paths = [...new Set(ROSTER.map((entry) => entry.path))]
  return (
    <section className="panel" id="messages">
      <div className="panel-head"><h2>Candidate communication</h2><small>Real-time messages to every PC, one centre, or one candidate. The platform also messages affected candidates automatically when it detects or resolves an incident.</small></div>
      <div className="row wrap">
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send to">
          <option value="all">All candidates</option>
          {paths.map((path) => <option key={path} value={path}>Centre path {path}</option>)}
          {ROSTER.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.name}</option>)}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Server maintenance in Pune-02 — keep answering, your time is protected." style={{ flex: 1, minWidth: 260 }} />
        <button className="btn small primary" disabled={!text.trim()} onClick={() => { api.postMessage(to, text.trim()); setText('') }}><Megaphone size={13} /> Send</button>
      </div>
      <ul className="evidence">{recent.map((message) => <li key={message.id}><small>{fmtTime(message.at)} → {message.to}{message.auto ? ' (automatic)' : ''}</small> {message.text}</li>)}</ul>
    </section>
  )
}

// ---------------------------------------------------------------- analytics

interface RiskReportResult {
  headline: string
  root_causes: Array<{ cause: string; evidence: string; affected: string }>
  risks: Array<{ area: string; severity: string; why: string }>
  recommendations: Array<{ action: string; priority: string; expected_effect: string }>
}

// Officers only: the server releases the answer key with the officer passcode.
let answerKeyCache: Promise<AnswerKey> | undefined
export function useAnswerKey() {
  const [keys, setKeys] = useState<AnswerKey>({})
  useEffect(() => {
    answerKeyCache ??= fetch('/api/answer-key', { headers: officerHeaders() }).then((r) => (r.ok ? r.json() : { keys: {} })).then((body) => body.keys ?? {}).catch(() => { answerKeyCache = undefined; return {} })
    void answerKeyCache.then(setKeys)
  }, [])
  return keys
}

export function riskContext(state: ExamState, answerKey: AnswerKey, nowMs = Date.now()) {
  const stats = systemicStats(state, nowMs)
  return {
    exam: { candidatesSignedIn: Object.keys(state.candidates).length, started: Object.values(state.candidates).filter((s) => s.startedAt).length, sessionMinutes: Math.round((nowMs - Date.parse(state.createdAt)) / 60000) },
    centres: stats.centres,
    incidentsPer5Minutes: stats.timeline,
    heartbeatLossCauses: stats.causes,
    paths: pathHealth(state, nowMs).map(({ path, centre, meanRtt, baselineRtt, forecast, reasons }) => ({ path, centre, meanRtt, baselineRtt, forecast, reasons })),
    devices: Object.values(state.candidates).filter((s) => s.telemetry).map((s) => ({ centre: rosterEntry(s.candidateId)?.centre, path: rosterEntry(s.candidateId)?.path, battery: s.telemetry!.battery ?? null, network: s.telemetry!.net ?? null, rttMs: s.telemetry!.rttMs, missed: s.telemetry!.missed, drops: s.outages.length })),
    incidents: state.control.incidents.map((incident) => ({ id: incident.id, kind: incident.kind, platformWide: Boolean(incident.platform), affected: incident.affected.length, centres: [...new Set(incident.affected.map((id) => rosterEntry(id)?.centre))], seconds: incident.restoredAt ? Math.round((Date.parse(incident.restoredAt) - Date.parse(incident.startedAt)) / 1000) : 'ongoing', remedy: incident.decision?.policy ?? 'pending' })),
    patternFlags: patternFlags(state, answerKey).map((flag) => ({ kind: flag.kind, count: flag.candidates.length })),
    examDecision: examDecision(state, nowMs),
  }
}

export function AnalyticsPanel({ api }: { api: ExamApi }) {
  const { state } = api
  const nowMs = useNow(5000)
  const stats = systemicStats(state, nowMs)
  const decision = examDecision(state, nowMs)
  const answerKey = useAnswerKey()
  const flags = patternFlags(state, answerKey)
  const report = state.control.riskReport
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = Object.values(state.candidates).filter((slice) => slice.startedAt)

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/risk-report', { method: 'POST', headers: { 'Content-Type': 'application/json', ...officerHeaders() }, body: JSON.stringify({ context: riskContext(state, answerKey, nowMs) }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      api.saveRiskReport({ at: body.at, model: body.model, result: body.result })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report failed')
    }
    setBusy(false)
  }

  return (
    <section className="panel" id="analytics">
      <div className="panel-head"><h2>Analytics &amp; decision support</h2><small>Systemic risk by centre and service path, cross-candidate patterns, response reconciliation, and whether the exam needs re-conducting.</small></div>

      <div className={`decision-banner ${decision.verdict}`}>
        <b>{decision.headline}</b>
        <ul>{decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {decision.affected.length > 0 && <small>Affected: {decision.affected.join(', ')}</small>}
      </div>

      <h3>Reliability by centre</h3>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Centre / path</th><th>Signed in</th><th>Started</th><th>Drops</th><th>Offline min</th><th>Incidents</th><th>Integrity</th><th>AI flags</th><th>Reliability</th></tr></thead>
          <tbody>{stats.centres.map((row) => (
            <tr key={row.path}><td><b>{row.centre}</b><small>{row.path}</small></td><td>{row.candidates}</td><td>{row.started}</td><td>{row.drops}</td><td>{row.offlineMinutes}</td><td>{row.incidents}</td><td>{row.integrity}</td><td>{row.aiFlags}</td>
              <td><span className="rel-bar"><i style={{ width: `${row.reliability}%` }} className={row.reliability < 60 ? 'bad' : row.reliability < 85 ? 'warn' : 'good'} /></span> {row.reliability}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {stats.timeline.length > 0 && <p className="small">Incidents per 5 minutes: {stats.timeline.map((slot) => `${slot.fromMinute}–${slot.fromMinute + 5} min: ${slot.count}`).join(' · ')}</p>}
      {Object.keys(stats.causes).length > 0 && <p className="small">Heartbeat-loss causes: {Object.entries(stats.causes).map(([cause, count]) => `${cause} ×${count}`).join(' · ')}</p>}

      <h3>Suspicious patterns across candidates</h3>
      {flags.length ? <ul className="evidence">{flags.map((flag) => <li key={flag.kind + flag.candidates.join()}><Pill tone={flag.adjacent ? 'bad' : 'warn'}>{flag.kind}{flag.adjacent ? ' · adjacent seats' : ''}</Pill> {flag.candidates.join(' & ')} — {flag.detail} <small>(review-only)</small></li>)}</ul> : <p className="muted small">No collusion, timing-sync, identical-code or rapid-answer patterns found.</p>}

      <h3>Response reconciliation</h3>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Candidate</th><th>Result</th><th>Checks</th></tr></thead>
          <tbody>{started.map((slice) => {
            const result = reconcile(state, slice.candidateId)
            const failed = result.checks.filter((check) => !check.ok)
            return <tr key={slice.candidateId}><td>{rosterEntry(slice.candidateId)?.name}<small>{slice.candidateId}</small></td><td><Pill tone={result.ok ? 'good' : 'bad'}>{result.ok ? 'Validated' : `${failed.length} issue(s)`}</Pill></td><td><small>{failed.length ? failed.map((check) => `${check.label}: ${check.detail}`).join(' · ') : `${result.checks.length} checks passed — ${result.checks[0]?.detail}`}</small></td></tr>
          })}</tbody>
        </table>
      </div>

      <h3>AI post-exam risk report</h3>
      <div className="row wrap">
        <button className="btn small primary" onClick={() => void generate()} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : <Bot size={13} />} {busy ? 'Claude is analysing the session…' : report ? 'Regenerate AI risk report' : 'Generate AI risk report'}</button>
        <small>Sends only aggregated numbers (no names, no images) to Claude.</small>
        {error && <small className="bad">{error}</small>}
      </div>
      {report && <RiskReportView report={report.result as RiskReportResult} at={report.at} model={report.model} />}
    </section>
  )
}

function RiskReportView({ report, at, model }: { report: RiskReportResult; at: string; model: string }) {
  return (
    <div className="risk-report">
      <small>{model} · {fmtTime(at)}</small>
      <p><b>{report.headline}</b></p>
      {report.root_causes.length > 0 && <><h4>Likely root causes</h4><ul>{report.root_causes.map((item) => <li key={item.cause}><b>{item.cause}</b> — {item.evidence} <small>({item.affected})</small></li>)}</ul></>}
      {report.risks.length > 0 && <><h4>Risks</h4><ul>{report.risks.map((item) => <li key={item.area}><Pill tone={item.severity === 'high' ? 'bad' : item.severity === 'medium' ? 'warn' : 'neutral'}>{item.severity}</Pill> <b>{item.area}</b> — {item.why}</li>)}</ul></>}
      {report.recommendations.length > 0 && <><h4>Prevent recurrence</h4><ul>{report.recommendations.map((item) => <li key={item.action}><Pill tone={item.priority === 'now' ? 'bad' : item.priority === 'before-next-exam' ? 'warn' : 'neutral'}>{item.priority}</Pill> {item.action} <small>→ {item.expected_effect}</small></li>)}</ul></>}
    </div>
  )
}

// ---------------------------------------------------------------- printable exam report

export function ReportPage({ state }: { state: ExamState }) {
  const [chain, setChain] = useState<ChainReport | null>(null)
  const [keyId, setKeyId] = useState('')
  const nowMs = Date.now()
  useEffect(() => {
    void verifyChain(state.sessionId, state.audit.filter((event) => event.digest)).then(setChain)
    fetch('/api/public-key').then((r) => r.json()).then((body) => setKeyId(body.keyId)).catch(() => setKeyId('unavailable'))
  }, [state])
  const slices = Object.values(state.candidates)
  const decision = examDecision(state, nowMs)
  const stats = systemicStats(state, nowMs)
  const answerKey = useAnswerKey()
  const flags = patternFlags(state, answerKey)
  const report = state.control.riskReport
  return (
    <main className="report-page">
      <header className="report-head">
        <Brand />
        <div><h1>Examination session report</h1><small>Session {state.sessionId} · generated {new Date().toLocaleString('en-IN')}</small></div>
        <button className="btn small no-print" onClick={() => window.print()}><Printer size={13} /> Print / save PDF</button>
      </header>
      <section>
        <h2>Integrity of this report</h2>
        <p>{chain ? chain.ok ? `Evidence chain intact: ${chain.links.length} SHA-256-sealed events, head ${chain.head}.` : `EVIDENCE CHAIN BROKEN at event ${chain.firstBroken}.` : 'Verifying…'} Receipts are signed by the exam server key {keyId}.</p>
      </section>
      <section>
        <h2>Decision</h2>
        <p><b>{decision.headline}</b></p>
        <ul>{decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </section>
      <section>
        <h2>Candidates</h2>
        <table className="table compact">
          <thead><tr><th>Candidate</th><th>Status</th><th>Answered</th><th>Offline</th><th>Issues (candidate response)</th><th>Reconciliation</th></tr></thead>
          <tbody>{slices.map((slice) => {
            const rep = sessionReport(state, slice.candidateId, slice.submittedAt ? Date.parse(slice.submittedAt) : nowMs)
            const rec = reconcile(state, slice.candidateId)
            return (
              <tr key={slice.candidateId}>
                <td>{rosterEntry(slice.candidateId)?.name}<small>{slice.candidateId} · {rosterEntry(slice.candidateId)?.centre}</small></td>
                <td>{slice.submitReason === 'cancelled' ? 'Cancelled' : state.control.reexams?.[slice.candidateId]?.status === 'granted' ? 'Re-exam granted' : slice.phase}</td>
                <td>{Object.values(slice.responses).filter((r) => r.answer !== undefined).length}/{BLUEPRINT.length}</td>
                <td>{fmtClock(rep.offlineSeconds)}</td>
                <td>{rep.items.length ? rep.items.map((item) => `${item.line} [${slice.acknowledgements?.[item.key]?.answer === 'yes' ? 'confirmed' : slice.acknowledgements?.[item.key]?.answer === 'no' ? 'DISPUTED' : 'not yet confirmed'}]`).join(' ') : 'none'}</td>
                <td>{slice.startedAt ? rec.ok ? 'validated' : rec.checks.filter((c) => !c.ok).map((c) => c.label).join(', ') : '—'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </section>
      <section>
        <h2>Incidents and remedies</h2>
        <table className="table compact">
          <thead><tr><th>Incident</th><th>Type</th><th>Window</th><th>Affected</th><th>Remedy</th></tr></thead>
          <tbody>{state.control.incidents.map((incident) => (
            <tr key={incident.id}><td>{incident.id}</td><td>{incident.platform ? 'Platform-wide' : incident.detected ? 'Detected' : 'Simulated'} · {incident.kind}</td><td>{fmtTime(incident.startedAt)} – {fmtTime(incident.restoredAt)}</td><td>{incident.affected.join(', ')}</td><td>{incident.decision ? `${policyLabel[incident.decision.policy]} (${incident.decision.auto ? 'auto' : incident.decision.officer})` : 'pending'}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <section>
        <h2>Systemic view</h2>
        <ul>{stats.centres.map((row) => <li key={row.path}>{row.centre} ({row.path}): reliability {row.reliability}, {row.drops} drop(s), {row.offlineMinutes} offline min, {row.incidents} incident(s)</li>)}</ul>
        {flags.length > 0 && <p>Review-only patterns: {flags.map((flag) => `${flag.kind} (${flag.candidates.join(' & ')})`).join('; ')}</p>}
      </section>
      {report && <section><h2>AI risk report</h2><RiskReportView report={report.result as RiskReportResult} at={report.at} model={report.model} /></section>}
    </main>
  )
}
