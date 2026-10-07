import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Bot, Camera, CameraOff, CheckCircle2, Database, Download, Gauge, LayoutDashboard, Maximize,
  Minimize, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, ShieldX, Siren, UsersRound, Wifi, WifiOff, Zap,
} from 'lucide-react'
import { lockState, offlineSeconds, remainingSeconds, verifyChain, windowEndsAt, type AuditEvent, type ChainReport, type ExamState, type Incident, type Policy } from './lib/core'
import { BLUEPRINT, ROSTER, rosterEntry } from './data/paper'
import { AnalyticsPanel, Announcements, CopilotBox, EarlyWarnings, InfraPanel } from './analyticsView'
import { deviceRisk } from './lib/analytics'
import { analyseIncident, heartbeatAge, OFFICER, reexamEvidence, sessionReport, type ExamApi } from './state'
import { Brand, fmtClock, fmtTime, Pill, policyLabel, ReceiptModal, useNow } from './ui'

const PHASE_LABEL = { login: 'Not signed in', instructions: 'Reading instructions', gate: 'System check', exam: 'In exam', submitted: 'Submitted' } as const
const PATHS = [...new Set(ROSTER.map((entry) => entry.path))]

function useChain(state: ExamState) {
  const [report, setReport] = useState<ChainReport | null>(null)
  useEffect(() => {
    let alive = true
    void verifyChain(state.sessionId, state.audit.filter((item) => item.digest)).then((result) => alive && setReport(result))
    return () => { alive = false }
  }, [state.sessionId, state.audit])
  return report
}

export function OpsApp({ api }: { api: ExamApi }) {
  const { state } = api
  const nowMs = useNow(1000)
  const chain = useChain(state)
  const [filter, setFilter] = useState('')
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [reportFor, setReportFor] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  // Tab-switch escalations reach the officer immediately.
  const alerts = state.audit.filter((item) => ((item.kind === 'integrity' && typeof item.data?.tabSwitch === 'number') || item.data?.alert === true) && !dismissed.includes(item.id)).slice(-6).reverse()

  const slices = Object.values(state.candidates)
  const inExam = slices.filter((slice) => slice.phase === 'exam')
  const healthy = inExam.filter((slice) => !slice.outages.some((o) => !o.to) && heartbeatAge(slice, nowMs) <= 8)
  const open = state.control.incidents.filter((incident) => !incident.restoredAt || !incident.decision)
  const signalsBy = useMemo(() => {
    const counts: Record<string, { integrity: number; ai: number }> = {}
    for (const item of state.audit) {
      if (!item.candidateId || (item.kind !== 'integrity' && item.kind !== 'ai')) continue
      counts[item.candidateId] ??= { integrity: 0, ai: 0 }
      counts[item.candidateId][item.kind] += 1
    }
    return counts
  }, [state.audit])
  const reexams = state.control.reexams ?? {}
  const reports = slices.filter((slice) => slice.report)
  const allReceipts = [...state.control.incidents.flatMap((incident) => Object.values(incident.decision?.receipts ?? {})), ...Object.values(reexams).flatMap((item) => (item.receipt ? [item.receipt] : []))]
  const windowEnd = windowEndsAt(state)
  const windowLeft = Math.round((windowEnd - nowMs) / 1000)
  const receipt = allReceipts.find((item) => item.id === receiptId)

  return (
    <main className="ops">
      <aside className="ops-nav">
        <Brand inverse />
        <nav>
          <a href="#sessions"><LayoutDashboard size={16} /> Live sessions</a>
          <a href="#incidents"><Siren size={16} /> Incidents {open.length > 0 && <b>{open.length}</b>}</a>
          <a href="#reexams"><AlertTriangle size={16} /> Re-exams {reports.length > 0 && <b>{reports.length}</b>}</a>
          <a href="#warnings"><Activity size={16} /> Early warning</a>
          <a href="#analytics"><Gauge size={16} /> Analytics</a>
          <a href="#messages"><Siren size={16} /> Announcements</a>
          <a href="#infra"><Database size={16} /> Infrastructure</a>
          <a href="#simulation"><Zap size={16} /> Simulation</a>
          <a href="#vault"><Database size={16} /> Evidence vault</a>
        </nav>
        <div className="ops-nav-foot">
          <Pill tone={api.syncConnected ? 'good' : 'warn'}>{api.syncConnected ? <Wifi size={12} /> : <WifiOff size={12} />} {api.syncConnected ? 'Relay live' : 'Relay reconnecting'}</Pill>
          <small>Session {state.sessionId.slice(-8)}</small>
          <small>{OFFICER}</small>
          <a href="/exam" target="_blank" rel="noreferrer">Open a candidate tab ↗</a>
        </div>
      </aside>

      <section className="ops-main">
        <header className="ops-head">
          <div><small>Exam Control Tower</small><h1>Morning shift · {BLUEPRINT.length}-item paper</h1></div>
          <div className="row">
            <label className="toggle" title="Exam-centre mode: camera optional; the invigilator verifies identity at the seat"><input type="checkbox" checked={Boolean(state.control.centreMode)} onChange={(e) => api.setCentreMode(e.target.checked)} /> Centre mode</label>
            <a className="btn small" href="/invigilator" target="_blank" rel="noreferrer">Invigilator console ↗</a>
            <span className="window-box">
              <small>Exam window</small>
              <b>{windowLeft > 0 ? `closes in ${fmtClock(windowLeft)}` : 'closed'}</b>
              <select aria-label="Exam window length" value={state.control.windowMinutes ?? 60} onChange={(e) => api.setWindow(Number(e.target.value))}>
                {[...new Set([2, 5, 10, 20, 45, 60, 90, state.control.windowMinutes ?? 60])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min window</option>)}
              </select>
            </span>
            <ResetButton onReset={api.reset} />
            {chain && <Pill tone={chain.ok ? 'good' : 'bad'}>{chain.ok ? <ShieldCheck size={13} /> : <ShieldX size={13} />} Evidence chain {chain.ok ? 'intact' : 'BROKEN'}</Pill>}
            <Pill tone={open.length ? 'bad' : 'good'}>{open.length ? `${open.length} incident(s) need attention` : 'No open incidents'}</Pill>
          </div>
        </header>

        {alerts.length > 0 && (
          <section className="alerts" aria-live="assertive">
            {alerts.map((item) => {
              const id = item.candidateId!
              const lock = lockState(state, id, nowMs)
              const cancelled = Boolean(state.control.cancellations?.[id])
              return (
                <div key={item.id} className={`alert ${item.data?.action}`}>
                  <ShieldAlert size={16} />
                  <span><b>{item.title}</b><small>{fmtTime(item.at)} · {rosterEntry(id)?.name} · {item.detail}</small></span>
                  {typeof item.data?.tabSwitch === 'number' && lock !== 'none' && !cancelled && <button className="btn small" onClick={() => api.liftLock(id)}>Resume candidate</button>}
                  {typeof item.data?.tabSwitch === 'number' && lock === 'suspended' && !cancelled && <button className="btn small danger" onClick={() => api.cancelAttempt(id)}>Cancel attempt</button>}
                  {cancelled && <Pill tone="bad">Cancelled</Pill>}
                  {item.data?.action === 'paper-tampered' && (state.control.paperTamper && state.control.paperTamper === item.data.path
                    ? <button className="btn small" onClick={() => api.setPaperTamper('')}>Re-issue clean paper</button>
                    : <Pill tone="good">Clean paper re-issued</Pill>)}
                  {item.data?.action === 'paper-tampered' && !state.candidates[id]?.startedAt && (state.control.reexams?.[id]
                    ? <Pill tone="info">Re-exam granted</Pill>
                    : <button className="btn small danger" onClick={() => api.rescheduleTampered(String(item.data?.path))}>Release centre with re-exam</button>)}
                  <button className="icon-btn" aria-label="Dismiss alert" onClick={() => setDismissed((list) => [...list, item.id])}>✕</button>
                </div>
              )
            })}
          </section>
        )}

        <section className="metrics">
          <Metric icon={<UsersRound size={18} />} label="Signed in" value={`${slices.length}/${ROSTER.length}`} detail={`${inExam.length} writing now`} />
          <Metric icon={<Activity size={18} />} label="Heartbeat OK" value={`${healthy.length}/${inExam.length}`} detail="in-exam sessions" tone={healthy.length === inExam.length ? 'good' : 'bad'} />
          <Metric icon={<ShieldAlert size={18} />} label="Review signals" value={String(state.audit.filter((e) => e.kind === 'integrity').length)} detail="integrity events" tone="warn" />
          <Metric icon={<Bot size={18} />} label="AI flags" value={String(state.audit.filter((e) => e.kind === 'ai').length)} detail="Claude frame reviews" tone="warn" />
          <Metric icon={<Database size={18} />} label="Checkpoints" value={String(state.checkpoints.length)} detail={`${state.checkpoints.filter((c) => c.status === 'queued' && state.candidates[c.candidateId] && c.at >= state.candidates[c.candidateId].loggedInAt).length} queued`} />
        </section>

        <section className="panel" id="sessions">
          <div className="panel-head"><h2>Live sessions</h2><small>Updates in real time from every PC. Rows appear the moment a candidate signs in.</small></div>
          <div className="table-wrap">
            <table className="table sessions">
              <thead><tr><th>Candidate</th><th>Status</th><th>Device / login</th><th>Progress</th><th>Time left</th><th>Heartbeat</th><th>Proctoring</th><th>AI proctor</th><th>Signals</th><th /></tr></thead>
              <tbody>
                {ROSTER.map((entry) => {
                  const slice = state.candidates[entry.id]
                  if (!slice) return (
                    <tr key={entry.id} className="absent"><td><b>{entry.name}</b><small>{entry.id} · {entry.centre} · {entry.path}</small></td><td colSpan={9}><small>Not signed in</small></td></tr>
                  )
                  const outage = slice.outages.find((o) => !o.to)
                  const age = heartbeatAge(slice, nowMs)
                  const live = slice.phase === 'exam'
                  const hbOk = !outage && age <= 8
                  const answered = Object.values(slice.responses).filter((r) => r.answer !== undefined).length
                  const counts = signalsBy[entry.id] ?? { integrity: 0, ai: 0 }
                  return (
                    <tr key={entry.id} className={live && !hbOk ? 'alert' : ''}>
                      <td><b>{entry.name}</b><small>{entry.id} · {entry.centre} · {entry.path}</small></td>
                      <td>
                        {reexams[entry.id]?.status === 'granted'
                          ? <Pill tone="bad">Affected · re-exam granted</Pill>
                          : slice.submitReason === 'cancelled' ? <Pill tone="bad">Cancelled (tab switching)</Pill>
                          : lockState(state, entry.id, nowMs) === 'suspended' ? <Pill tone="bad">Suspended — decide</Pill>
                          : lockState(state, entry.id, nowMs) === 'locked' ? <Pill tone="warn">Locked 10 min</Pill>
                          : slice.report ? <Pill tone="warn">Reported: could not take exam</Pill>
                          : <Pill tone={slice.phase === 'exam' ? 'info' : slice.phase === 'submitted' ? 'good' : 'neutral'}>{PHASE_LABEL[slice.phase]}</Pill>}
                        {slice.submitReason === 'reschedule' && !slice.report && <small>Reschedule</small>}
                      </td>
                      <td><small>{slice.device ?? '—'}</small><small>since {fmtTime(slice.loggedInAt)}</small></td>
                      <td>{slice.startedAt ? <><b>{answered}/{BLUEPRINT.length}</b><small>on {slice.current}</small></> : '—'}</td>
                      <td>{slice.startedAt ? fmtClock(remainingSeconds(state, entry.id, nowMs)) : '—'}</td>
                      <td>
                        {slice.phase === 'gate' ? (age <= 8 ? <small>system check · {age}s ago</small> : <Pill tone="bad"><WifiOff size={12} /> silent {age}s at system check</Pill>) : live ? hbOk ? <Pill tone="good"><Wifi size={12} /> {age}s ago</Pill> : <Pill tone="bad"><WifiOff size={12} /> {outage ? `offline ${fmtClock(Math.round((nowMs - Date.parse(outage.from)) / 1000))}` : `silent ${age}s`}</Pill> : '—'}
                        {live && deviceRisk(slice, nowMs).level !== 'ok' && <Pill tone={deviceRisk(slice, nowMs).level === 'high' ? 'bad' : 'warn'}>risk {deviceRisk(slice, nowMs).score}</Pill>}
                        {live && slice.telemetry && <small>RTT {slice.telemetry.rttMs} ms{slice.telemetry.battery ? ` · 🔋${slice.telemetry.battery.level}%${slice.telemetry.battery.charging ? '⚡' : ''}` : ''}</small>}
                        {offlineSeconds(slice, nowMs) >= 1 && <small>offline total {fmtClock(Math.round(offlineSeconds(slice, nowMs)))}{outage ? ' · answering locally' : ''}</small>}
                      </td>
                      <td className="icons">
                        {slice.media ? <>
                          <span title={slice.media.camera ? 'Camera live' : 'Camera off'}>{slice.media.camera ? <Camera size={15} className="ok" /> : <CameraOff size={15} className="bad" />}</span>
                          <span title={slice.media.fullscreen ? 'Fullscreen' : 'Not fullscreen'}>{slice.media.fullscreen ? <Maximize size={15} className="ok" /> : <Minimize size={15} className="bad" />}</span>
                          {slice.media.obstructed && <Pill tone="bad">covered</Pill>}
                          {typeof slice.media.faces === 'number' && <Pill tone={slice.media.faces === 1 ? 'good' : 'bad'}>{slice.media.faces === 1 ? '1 face' : `${slice.media.faces} faces`}</Pill>}
                        </> : <small>—</small>}
                        {slice.warnings > 0 && <Pill tone="warn">{slice.warnings} warn</Pill>}
                      </td>
                      <td className="ai-cell">{slice.ai ? slice.ai.error ? <small className="bad">{slice.ai.error}</small> : <><Pill tone={slice.ai.risk === 'none' ? 'good' : slice.ai.risk === 'low' ? 'warn' : 'bad'}>{slice.ai.risk} · {slice.ai.faces ?? '?'} face(s)</Pill><small>{slice.ai.summary}</small></> : <small>—</small>}</td>
                      <td><button className="link-btn" onClick={() => setReportFor(entry.id)}>Session report</button>{slice.acknowledgedAt && <Pill tone={Object.values(slice.acknowledgements ?? {}).some((a) => a.answer === 'no') ? 'bad' : 'good'}>{Object.values(slice.acknowledgements ?? {}).filter((a) => a.answer === 'no').length ? `${Object.values(slice.acknowledgements ?? {}).filter((a) => a.answer === 'no').length} disputed` : 'confirmed'}</Pill>}<small>{counts.integrity + counts.ai} events · {slice.tabSwitches ?? 0} tab switch</small></td>
                      <td className="actions">
                        {slice.assistedRequested && !state.control.assistedApproved[entry.id] && <button className="btn small primary" onClick={() => api.approveAssisted(entry.id)}>Approve assisted entry</button>}
                        {live && <button className="btn small" onClick={() => api.injectOutage('candidate-network', entry.id)} title="Simulate this PC losing the exam API">Drop network</button>}
                        <ConfirmButton label="Reset" confirm={`Reset ${entry.id}?`} onConfirm={() => api.resetCandidate(entry.id)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <EarlyWarnings state={state} nowMs={nowMs} />

        <section className="panel" id="incidents">
          <div className="panel-head"><h2>Incidents &amp; Cohort Remedy Engine</h2><small>Detected from real heartbeats (network cut, server down, tab closed) or injected below. Officers approve every high-stakes remedy; no marks are ever changed.</small></div>
          {!state.control.incidents.length && <p className="muted">No incidents yet.</p>}
          {[...state.control.incidents].reverse().map((incident) => <IncidentCard key={incident.id} incident={incident} api={api} nowMs={nowMs} onReceipt={setReceiptId} />)}
        </section>

        <section className="panel" id="reexams">
          <div className="panel-head"><h2>Re-exam requests</h2><small>Candidates who could not take the exam. A re-exam is granted only to that candidate — automatically when the platform's own records confirm the loss, otherwise by an officer.</small></div>
          {!reports.length && <p className="muted">No candidate has reported being unable to take the exam.</p>}
          {reports.map((slice) => <ReexamRow key={slice.candidateId} api={api} id={slice.candidateId} onReceipt={setReceiptId} />)}
        </section>

        <AnalyticsPanel api={api} />
        <Announcements api={api} />
        <InfraPanel api={api} />

        <section className="panel" id="simulation">
          <div className="panel-head"><h2>Simulation controls</h2><small>Clearly-labelled test faults. Real network loss is detected without these.</small></div>
          <div className="sim-grid">
            <div>
              <h3>Pre-exam faults (readiness gate)</h3>
              <label className="toggle">Alter paper in transit for
                <select aria-label="Tamper drill path" value={state.control.paperTamper ?? ''} onChange={(e) => api.setPaperTamper(e.target.value)}>
                  <option value="">nobody (genuine paper)</option>
                  {PATHS.map((path) => <option key={path} value={path}>{path} · {ROSTER.find((entry) => entry.path === path)?.centre}</option>)}
                </select>
              </label>
              <label className="toggle"><input type="checkbox" checked={state.control.faults.saveChannelDown} onChange={(e) => api.setFault('saveChannelDown', e.target.checked)} /> Disable answer-save channel</label>
            </div>
            <div>
              <h3>Shared exam-API outage</h3>
              {PATHS.map((path) => {
                const count = Object.keys(state.candidates).filter((id) => rosterEntry(id)?.path === path && state.candidates[id].phase !== 'submitted').length
                return <button key={path} className="btn small" disabled={!count} onClick={() => api.injectOutage('service-outage', path)}><Zap size={13} /> Outage on {path} ({count} session{count === 1 ? '' : 's'})</button>
              })}
            </div>
            <div>
              <h3>Policy</h3>
              <label className="field-inline">Auto-recover grace
                <select value={state.control.graceSeconds} onChange={(e) => api.setPolicy({ graceSeconds: Number(e.target.value) })}>{[10, 20, 30, 60].map((v) => <option key={v} value={v}>{v}s</option>)}</select>
              </label>
              <label className="field-inline">Reschedule threshold
                <select value={state.control.thresholdSeconds} onChange={(e) => api.setPolicy({ thresholdSeconds: Number(e.target.value) })}>{[60, 120, 180, 300, 600].map((v) => <option key={v} value={v}>{v / 60} min</option>)}</select>
              </label>
            </div>
          </div>
        </section>

        <EvidenceVault state={state} api={api} chain={chain} filter={filter} setFilter={setFilter} receipts={allReceipts.map((r) => r.id)} onReceipt={setReceiptId} />
      </section>
      {receipt && <ReceiptModal receipt={receipt} state={state} printable onClose={() => setReceiptId(null)} />}
      {reportFor && (
        <div className="modal-backdrop" onClick={() => setReportFor(null)}>
          <section className="modal" role="dialog" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="report-title">Session report · {rosterEntry(reportFor)?.name} ({reportFor})</h2>
            {(() => {
              const slice = state.candidates[reportFor]
              const report = sessionReport(state, reportFor, slice?.submittedAt ? Date.parse(slice.submittedAt) : nowMs)
              const acks = slice?.acknowledgements
              return (
                <>
                  <ul className="evidence">
                    {report.items.map((item) => (
                      <li key={item.key}>{item.line} {acks?.[item.key]
                        ? <Pill tone={acks[item.key].answer === 'yes' ? 'good' : 'bad'}>{acks[item.key].answer === 'yes' ? 'Candidate confirmed' : `Candidate disputed${acks[item.key].note ? `: “${acks[item.key].note}”` : ''}`}</Pill>
                        : <Pill tone="neutral">{slice?.phase === 'submitted' ? 'Awaiting candidate confirmation' : 'Exam in progress'}</Pill>}</li>
                    ))}
                    {report.lines.filter((line) => !report.items.some((item) => item.line === line)).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                  {slice?.acknowledgedAt && <small>Confirmed by the candidate at {fmtTime(slice.acknowledgedAt)} (sealed in the evidence chain).</small>}
                </>
              )
            })()}
            <footer><button className="btn" onClick={() => { setFilter(reportFor); setReportFor(null); window.location.hash = 'vault' }}>Show all events</button><button className="btn primary" onClick={() => setReportFor(null)}>Close</button></footer>
          </section>
        </div>
      )}
    </main>
  )
}

function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])
  return <button className="btn small danger" title="Clear this candidate's attempt so they can take the exam again" onClick={() => (armed ? (onConfirm(), setArmed(false)) : setArmed(true))}><RotateCcw size={12} /> {armed ? confirm : label}</button>
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armed])
  return <button className="btn small danger" onClick={() => (armed ? (onReset(), setArmed(false)) : setArmed(true))}><RotateCcw size={13} /> {armed ? 'Click again: reset every PC' : 'Reset exam session'}</button>
}

function ReexamRow({ api, id, onReceipt }: { api: ExamApi; id: string; onReceipt: (id: string) => void }) {
  const slice = api.state.candidates[id]
  const decision = api.state.control.reexams?.[id]
  const evidence = decision?.evidence ?? reexamEvidence(api.state, id)
  const [note, setNote] = useState('')
  return (
    <article className={`incident ${decision?.status === 'granted' ? 'decided' : decision ? '' : 'ongoing'}`}>
      <header>
        <b>{id}</b><span>{rosterEntry(id)?.name}</span>
        <Pill tone={decision?.status === 'granted' ? 'bad' : decision ? 'neutral' : 'warn'}>{decision?.status === 'granted' ? `Affected — re-exam granted (${decision.auto ? 'auto, evidence-backed' : decision.officer})` : decision ? 'Not granted' : 'Needs officer review'}</Pill>
        <span className="spacer" />
        {decision?.receipt && <button className="link-btn" onClick={() => onReceipt(decision.receipt!.id)}>{decision.receipt.id}</button>}
      </header>
      <p className="small"><b>Candidate report ({fmtTime(slice?.report?.at)}):</b> {slice?.report?.reason} <small>{slice?.report?.answered ?? 0} answer(s) saved before the interruption · reported from phase “{slice?.report?.phase}”.</small></p>
      <ul className="evidence">{evidence.length ? evidence.map((item) => <li key={item}>{item}</li>) : <li>No platform record corroborates this report yet.</li>}</ul>
      {!decision && (
        <div className="row wrap">
          <input placeholder="Officer note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn small primary" onClick={() => void api.grantReexam(id, false, note.trim() || 'Officer verified the candidate could not take the exam.', OFFICER)}>Grant re-exam to {id} only</button>
          <button className="btn small danger" disabled={!note.trim()} onClick={() => api.rejectReexam(id, note.trim(), OFFICER)}>Reject</button>
        </div>
      )}
    </article>
  )
}

function Metric({ icon, label, value, detail, tone = 'neutral' }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <div className={`metric ${tone}`}>{icon}<span><small>{label}</small><b>{value}</b><em>{detail}</em></span></div>
}

function IncidentCard({ incident, api, nowMs, onReceipt }: { incident: Incident; api: ExamApi; nowMs: number; onReceipt: (id: string) => void }) {
  const analysis = analyseIncident(api.state, incident, nowMs)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [officer, setOfficer] = useState(OFFICER)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = policy ?? analysis.policy
  const override = chosen !== analysis.policy
  const status = incident.decision ? 'decided' : incident.restoredAt ? analysis.ready ? 'awaiting-officer' : 'measuring' : 'ongoing'
  // Escalate when an officer decision is still missing two minutes after service came back.
  const overdue = status === 'awaiting-officer' && analysis.needsOfficer && nowMs - Date.parse(incident.restoredAt!) > 120_000

  const approve = async () => {
    setBusy(true)
    await api.decide(incident.id, chosen, `${override ? `Officer override (recommended ${policyLabel[analysis.policy]}): ${note}` : analysis.reasons.join(' ')}${!override && note ? ` Note: ${note}` : ''}`.trim(), officer)
    setBusy(false)
  }

  return (
    <article className={`incident ${status}`}>
      <header>
        <b>{incident.id}</b>
        <Pill tone={incident.detected ? 'info' : 'neutral'}>{incident.detected ? 'Detected by watchdog' : 'Injected (simulation)'}</Pill>
        <Pill tone={analysis.scope === 'cohort' ? 'bad' : 'warn'}>{analysis.scope === 'cohort' ? `Shared outage · ${analysis.path ?? incident.servicePath}` : 'Single candidate'}</Pill>
        <Pill tone={status === 'decided' ? 'good' : status === 'ongoing' ? 'bad' : 'warn'}>{status === 'ongoing' ? `Ongoing ${analysis.lostSeconds}s` : status === 'measuring' ? 'Restored · waiting for session reports' : status === 'awaiting-officer' ? 'Officer decision needed' : `Decided: ${policyLabel[incident.decision!.policy]}`}</Pill>
        {overdue && <Pill tone="bad">Overdue — escalated to chief officer</Pill>}
        <span className="spacer" />
        {!incident.restoredAt && <button className="btn small primary" onClick={() => api.restoreService(incident.id)}><RefreshCw size={13} /> {incident.detected ? 'Mark restored' : 'Restore service'}</button>}
      </header>
      <table className="table compact">
        <thead><tr><th>Candidate</th><th>Lost interval (measured)</th><th>Seconds</th>{incident.decision && <th>Credit</th>}{incident.decision && <th>Receipt</th>}</tr></thead>
        <tbody>
          {incident.affected.map((id) => {
            const interval = analysis.intervals[id]
            const receipt = incident.decision?.receipts[id]
            return (
              <tr key={id}>
                <td>{rosterEntry(id)?.name} <small>{id}</small></td>
                <td>{interval ? `${fmtTime(interval.from)} → ${fmtTime(interval.to)}` : incident.restoredAt ? 'waiting for this PC to report…' : `since ${fmtTime(incident.startedAt)}`}</td>
                <td>{interval?.seconds ?? '—'}</td>
                {incident.decision && <td>+{incident.decision.credits[id] ?? 0}s</td>}
                {incident.decision && <td>{receipt ? <button className="link-btn" onClick={() => onReceipt(receipt.id)}>{receipt.id}</button> : <small>not in exam</small>}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!incident.decision && (
        <div className="remedy">
          <div>
            <small>Engine recommendation</small>
            <b>{policyLabel[analysis.policy]}{analysis.needsOfficer ? ' — officer approval required' : ' — low-stakes, auto-applies when measured'}</b>
            <ul>{analysis.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
          {analysis.ready && (
            <div className="decision-form">
              <CopilotBox state={api.state} incident={incident} />
              <fieldset>
                <legend>Remedy</legend>
                {(['recover', 'protect-time', 'reschedule'] as Policy[]).map((option) => (
                  <label key={option}><input type="radio" name={`policy-${incident.id}`} checked={chosen === option} onChange={() => setPolicy(option)} /> {policyLabel[option]}{option === analysis.policy && ' (recommended)'}</label>
                ))}
              </fieldset>
              <label>Officer<input value={officer} onChange={(e) => setOfficer(e.target.value)} /></label>
              <label>{override ? 'Override reason (required)' : 'Note (optional)'}<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></label>
              <button className="btn primary" disabled={busy || !officer.trim() || (override && !note.trim())} onClick={() => void approve()}><ShieldCheck size={14} /> {busy ? 'Sealing receipts…' : 'Approve & issue receipts'}</button>
            </div>
          )}
        </div>
      )}
      {incident.decision && <p className="muted small"><CheckCircle2 size={13} /> {incident.decision.auto ? 'Auto-applied' : `Approved by ${incident.decision.officer}`} at {fmtTime(incident.decision.at)}. {incident.decision.reason}</p>}
    </article>
  )
}

function EvidenceVault({ state, api, chain, filter, setFilter, receipts, onReceipt }: {
  state: ExamState; api: ExamApi; chain: ChainReport | null; filter: string; setFilter: (value: string) => void; receipts: string[]; onReceipt: (id: string) => void
}) {
  const [kind, setKind] = useState('')
  const [target, setTarget] = useState('')
  const links = new Map(chain?.links.map((link) => [link.id, link]) ?? [])
  const events = state.audit.filter((item) => (!filter || item.candidateId === filter) && (!kind || item.kind === kind)).slice(-60).reverse()
  const tamperable = state.audit.filter((item) => item.digest && item.kind === 'checkpoint')

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ sessionId: state.sessionId, audit: state.audit, checkpoints: state.checkpoints }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `examshield-audit-${state.sessionId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="panel" id="vault">
      <div className="panel-head">
        <h2>Evidence vault</h2>
        {chain && (chain.ok
          ? <Pill tone="good"><ShieldCheck size={13} /> {chain.links.length} events · SHA-256 chain intact · head {chain.head.slice(0, 12)}…</Pill>
          : <Pill tone="bad"><ShieldX size={13} /> Chain broken at {chain.firstBroken}</Pill>)}
      </div>
      <div className="row wrap">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by candidate"><option value="">All candidates</option>{ROSTER.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}</select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by kind"><option value="">All kinds</option>{['access', 'release', 'checkpoint', 'heartbeat', 'incident', 'recovery', 'approval', 'integrity', 'ai', 'submission'].map((k) => <option key={k}>{k}</option>)}</select>
        <button className="btn small" onClick={download}><Download size={13} /> Export audit JSON</button>
        {receipts.length > 0 && <select onChange={(e) => e.target.value && onReceipt(e.target.value)} value="" aria-label="Open receipt"><option value="">Open a receipt…</option>{receipts.map((id) => <option key={id}>{id}</option>)}</select>}
      </div>
      <div className="tamper">
        <AlertTriangle size={15} />
        <span>Tamper test: edit a recorded answer checkpoint without re-sealing it. Every receipt that covers it must fail verification.</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Event to tamper"><option value="">Choose checkpoint…</option>{tamperable.map((item) => <option key={item.id} value={item.id}>{fmtTime(item.at)} · {item.candidateId} · {item.title}</option>)}</select>
        <button className="btn small danger" disabled={!target} onClick={() => { api.tamper(target); setTarget('') }}>Edit event</button>
      </div>
      <div className="table-wrap">
        <table className="table compact vault">
          <thead><tr><th>Time</th><th>Kind</th><th>Event</th><th>Source</th><th>Digest</th><th>Chain</th></tr></thead>
          <tbody>{events.map((item) => <VaultRow key={item.id} item={item} valid={links.get(item.id)?.valid} />)}</tbody>
        </table>
      </div>
    </section>
  )
}

function VaultRow({ item, valid }: { item: AuditEvent; valid?: boolean }) {
  return (
    <tr className={valid === false ? 'broken' : ''}>
      <td>{fmtTime(item.at)}</td>
      <td><span className={`kind ${item.kind}`}>{item.kind}</span></td>
      <td><b>{item.title}</b><small>{item.detail}</small></td>
      <td><small>{item.source}</small></td>
      <td><code>{item.digest ? `${item.digest.slice(0, 10)}…` : 'sealing…'}</code></td>
      <td>{valid === undefined ? <Gauge size={14} /> : valid ? <CheckCircle2 size={14} className="ok" /> : <ShieldX size={14} className="bad" />}</td>
    </tr>
  )
}
