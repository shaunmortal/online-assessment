import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle, BadgeCheck, Bot, Camera, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Eye, Flag, Loader2,
  LockKeyhole, Maximize, Megaphone, Mic, Play, ReceiptText, RefreshCw, Send, ShieldAlert, Wifi, WifiOff, XCircle,
} from 'lucide-react'
import { apiReachable, lockState, offlineSeconds, openIncidents, remainingSeconds, windowEndsAt, EXAM_SECONDS, TAB_LOCK_MINUTES, type CandidateSlice, type ExamState, type Lang, type Receipt } from './lib/core'
import { probeSaveChannel } from './lib/idb'
import { pythonLoaded, runCases, type CaseResult } from './lib/runner'

interface CodeDraft { code: string; lang: CodeLang }
import { BLUEPRINT, CODE_LANGS, PAPER, SECTIONS, rosterEntry, seatLabel, type CodeLang, type CodingQuestion, type McqQuestion, type Question } from './data/paper'
import { QUESTIONS, loadPaper, paperInfo, preloadPaper, questionById } from './lib/paperClient'
import { DOB_KEY, messagesFor, sessionReport, type ExamApi, type ReportItem } from './state'
import { useAiProctor, useIntegrity, type Integrity } from './hooks/useIntegrity'
import { BinaryTree, Brand, fmtClock, fmtTime, Pill, ReceiptModal, useNow } from './ui'

export function CandidateApp({ api }: { api: ExamApi }) {
  const phase = api.mine?.phase ?? 'login'
  const integrity = useIntegrity(api.recordSignal)
  const ai = useAiProctor({
    active: (phase === 'instructions' || phase === 'gate' || phase === 'exam') && integrity.mediaStatus === 'ready',
    candidateId: api.me ?? undefined,
    captureJpeg: integrity.captureJpeg,
    onStatus: api.setAiStatus,
    onSignal: api.recordSignal,
  })
  const { reportMedia } = api
  useEffect(() => {
    if (phase === 'instructions' || phase === 'gate' || phase === 'exam') reportMedia({ camera: integrity.mediaStatus === 'ready', fullscreen: integrity.isFullscreen, obstructed: integrity.obstructed, faces: integrity.faces })
  }, [phase, integrity.mediaStatus, integrity.isFullscreen, integrity.obstructed, integrity.faces, reportMedia])
  const aiCheckNow = ai.checkNow
  useEffect(() => {
    integrity.onFaceAlert.current = (count) => { if (count !== 1) void aiCheckNow('face-alert') }
  }, [integrity.onFaceAlert, aiCheckNow])
  const nowMs = useNow(1000)
  const windowClosed = nowMs >= windowEndsAt(api.state)

  if (api.otherDevice) return <OtherDevice api={api} />

  // Could not take the exam: reported, disconnected when the window closed, or never got past the gate.
  // ...or released by an officer with a re-exam before starting (e.g. a tampered paper at the centre).
  const released = api.mine && !api.mine.startedAt && api.state.control.reexams?.[api.mine.candidateId]?.status === 'granted'
  if (api.mine && (api.mine.report || released || (windowClosed && (phase === 'instructions' || phase === 'gate')))) return <Affected api={api} />

  switch (phase) {
    case 'login': return <Login api={api} integrity={integrity} />
    case 'instructions': return <Instructions api={api} integrity={integrity} />
    case 'gate': return <Gate api={api} integrity={integrity} />
    case 'exam': return <PaperReady api={api}><Exam api={api} integrity={integrity} aiCheck={ai.checkNow} aiEnabled={Boolean(ai.config?.enabled)} /></PaperReady>
    default: return <Submitted api={api} />
  }
}

// A reloaded or moved exam tab re-downloads and re-verifies the paper (or re-verifies its offline copy).
function PaperReady({ api, children }: { api: ExamApi; children: React.ReactNode }) {
  const [ready, setReady] = useState(QUESTIONS.length > 0)
  const [error, setError] = useState('')
  useEffect(() => {
    if (ready) return
    let alive = true
    let timer: number | undefined
    const attempt = () => void loadPaper(api.me ?? '', window.sessionStorage.getItem(DOB_KEY) ?? '', api.state.sessionId).then((result) => {
      if (!alive) return
      if (result.ok) return setReady(true)
      setError(result.reason)
      timer = window.setTimeout(attempt, 5000)
    })
    attempt()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [ready, api.me, api.state.sessionId])
  if (ready) return <>{children}</>
  return (
    <main className="doc-page">
      <section className="doc-card center">
        <Loader2 size={28} className="spin" />
        <h1>Verifying your signed question paper…</h1>
        <p className="muted">{error ? `${error} Retrying every 5 seconds. Your timer and saved answers are safe.` : 'Checking the exam authority signature and every question before showing the paper.'}</p>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------- login

function Login({ api, integrity }: { api: ExamApi; integrity: Integrity }) {
  const [id, setId] = useState('')
  const [dob, setDob] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Fullscreen needs the click gesture, so request it before awaiting the server.
    if (!document.fullscreenElement && rosterEntry(id.trim().toUpperCase())?.dob === dob.replace(/\D/g, '')) void integrity.requestFullscreen()
    setBusy(true)
    await api.fetchCandidate(id, dob)
    setBusy(false)
    const failed = api.login(id, dob)
    setError(failed ?? '')

  }
  return (
    <main className="login-page">
      <aside className="login-hero">
        <Brand inverse />
        <div>
          <p className="eyebrow">Morning shift · 09:30 IST</p>
          <h1>{PAPER.title}</h1>
          <dl className="hero-facts">
            <div><dt>Duration</dt><dd>{EXAM_SECONDS / 60} min</dd></div>
            <div><dt>Questions</dt><dd>{BLUEPRINT.length}</dd></div>
            <div><dt>Sections</dt><dd>{SECTIONS.length}</dd></div>
          </dl>
          <p className="hero-note">Your answers are saved on this device and on the exam server after every choice. If your connection drops, stay on the page — lost time is measured and reviewed fairly.</p>
        </div>
        <small>Paper {PAPER.code.replace('Paper ', '')} · build {PAPER.version}</small>
      </aside>
      <section className="login-card">
        <p className="eyebrow">Candidate sign-in</p>
        <h2>Welcome</h2>
        <p className="muted">Use the Candidate ID and date of birth printed on your admit card.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Candidate ID<input value={id} onChange={(e) => setId(e.target.value)} placeholder="EXM-20841" autoComplete="username" required /></label>
          <label>Date of birth (DDMMYYYY)<input value={dob} onChange={(e) => setDob(e.target.value)} placeholder="14082004" inputMode="numeric" type="password" autoComplete="current-password" required /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <details className="demo-creds">
          <summary>Demo credentials</summary>
          <p>EXM-20841 / 14082004 · EXM-20873 / 17072004 · EXM-20891 / 19092003</p>
        </details>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------- instructions

function CameraCheck({ integrity }: { integrity: Integrity }) {
  const on = integrity.mediaStatus === 'ready'
  const faces = integrity.faces
  const tone = !on ? 'idle' : faces === 1 ? 'ok' : faces === null ? 'wait' : 'bad'
  return (
    <div className={`camera-check ${tone}`}>
      <div className="cam small">
        <video ref={integrity.attachVideo} autoPlay muted playsInline aria-label="Your camera preview" />
        {!on && <span className="cam-empty"><Camera size={20} /> Camera off</span>}
      </div>
      <div className="camera-check-body">
        <b>Camera &amp; microphone check</b>
        <p className="muted small">{!on
          ? integrity.mediaStatus === 'requesting' ? 'Waiting for your browser permission…' : integrity.mediaStatus === 'idle' ? 'Allow access so the proctor can see that you are alone at your desk. Monitoring starts now and continues until you submit.' : integrity.mediaMessage
          : faces === null ? (integrity.faceError || 'Starting face detection…')
          : faces === 1 ? 'Face detected — you are alone in view. AI proctoring is active.'
          : faces === 0 ? 'No face detected. Sit in front of the camera with your face clearly lit.'
          : `${faces} faces detected. Only the candidate may be in view.`}</p>
        <div className="row wrap">
          {!on && <button className="btn primary" onClick={() => void integrity.requestMedia()} disabled={integrity.mediaStatus === 'requesting'}><Camera size={15} /> Allow camera &amp; microphone</button>}
          {on && <span className="meter" aria-label="Microphone level"><Mic size={14} /><i style={{ width: `${Math.max(3, integrity.audioLevel * 100)}%` }} /></span>}
          {on && faces !== null && <Pill tone={faces === 1 ? 'good' : 'bad'}>{faces} face{faces === 1 ? '' : 's'} in view</Pill>}
        </div>
      </div>
    </div>
  )
}

function Instructions({ api, integrity }: { api: ExamApi; integrity: Integrity }) {
  const [agreed, setAgreed] = useState(false)
  const [lang, setLang] = useState<Lang>(api.mine!.lang)
  const entry = rosterEntry(api.me ?? undefined)
  const centre = Boolean(api.state.control.centreMode)
  // Stage the encrypted paper while the candidate reads the rules; only the key comes at exam time.
  const [staged, setStaged] = useState<string | null>(null)
  const { recordSignal } = api
  useEffect(() => {
    if (!entry) return
    let alive = true
    void preloadPaper(entry.id).then((result) => {
      if (!alive || !result) return
      setStaged(result.at)
      if (result.fresh) recordSignal('Encrypted paper pre-loaded on this PC', 'The AES-256-GCM encrypted paper is stored on this PC. It cannot be read until the exam server releases the key in the exam window.', 'release', { action: 'paper-staged' })
    })
    return () => { alive = false }
  }, [entry, recordSignal])
  const cameraOk = centre || integrity.faces === 1 || integrity.mediaStatus === 'denied' || integrity.mediaStatus === 'unavailable'
  return (
    <main className="doc-page">
      <header className="bar"><Brand inverse /><span>{entry?.name} · {entry?.id}{centre ? ` · ${seatLabel(entry)}` : ''}</span></header>
      <section className="doc-card">
        <h1>General Instructions</h1>
        <table className="table">
          <thead><tr><th>Section</th><th>Questions</th><th>Marking</th></tr></thead>
          <tbody>{SECTIONS.map((section) => <tr key={section.id}><td>{section.name.en}</td><td>{BLUEPRINT.filter((q) => q.section === section.id).length}</td><td>{section.marks}</td></tr>)}</tbody>
        </table>
        <ol className="rules">
          <li>Total duration is <b>{EXAM_SECONDS / 60} minutes</b>. The clock keeps running if you reload or lose the connection, and the exam auto-submits at 00:00:00.</li>
          <li>Your answer is saved automatically each time you pick an option (a checkpoint is written to this device and to the exam server).</li>
          <li>Question palette colours:
            <span className="legend-inline"><i className="st not-visited" /> Not visited <i className="st not-answered" /> Not answered <i className="st answered" /> Answered <i className="st marked" /> Marked for review <i className="st answered-marked" /> Answered &amp; marked</span>
          </li>
          <li>The paper is protected by <b>BlurShield</b>: only the area under your pointer or keyboard focus is sharp. Press <kbd>Alt</kbd>+<kbd>R</kbd> for a 15-second wider reading lens. Diagrams stay clear.</li>
          {centre
            ? <li>This is an <b>exam-centre</b> sitting at <b>{entry?.centre} · {seatLabel(entry)}</b>. The invigilator verifies your admit card and photo ID at your seat before your timer can start. Fullscreen is required; a camera is used only if this PC has one.</li>
            : <li>Camera, microphone and fullscreen are required for the whole exam. From the moment you allow the camera until you submit, an on-device face monitor and the AI proctor watch continuously for other people, phones and an empty seat. Leaving fullscreen, copy/paste and every observation are reported to the exam officer.</li>}
          <li><b>Tab switching</b> is reported to the exam officer immediately: 1st time a warning, 2nd time the paper is <b>locked for {TAB_LOCK_MINUTES} minutes</b> (the timer keeps running), 3rd time the exam is <b>suspended</b> until the officer resumes or cancels it.</li>
          <li>If the connection drops, <b>do not close the tab</b>. <b>Keep answering</b> — every answer is saved on this device and syncs automatically when the internet returns. The timer keeps running; your offline time is shown next to it and reported to the exam office.</li>
          <li>Coding problems come with a function template in JavaScript or Python. Complete the function; the read-only driver code handles input and output. <b>Run samples</b> checks the visible cases, <b>Submit code</b> also runs hidden test cases.</li>
        </ol>
        <label className="field-inline">Question language
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
          </select>
        </label>
        <label className="declaration"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I have read the instructions, I will not use unfair means, and I consent to camera/microphone monitoring and AI-assisted frame review for this exam.</label>
        <CameraCheck integrity={integrity} />
        <p className="muted small"><LockKeyhole size={13} /> {staged ? `Encrypted question paper ready on this PC since ${fmtTime(staged)} — it opens only when the exam starts.` : 'Preparing the encrypted question paper on this PC…'}</p>
        <button className="btn primary" disabled={!agreed || !cameraOk} onClick={() => api.acceptInstructions(lang)}>
          {!agreed ? 'Accept the declaration to continue' : centre ? 'I am ready — run system check' : integrity.mediaStatus !== 'ready' && integrity.mediaStatus !== 'denied' && integrity.mediaStatus !== 'unavailable' ? 'Allow camera & microphone to continue' : integrity.faces === 1 || integrity.mediaStatus !== 'ready' ? 'I am ready — run system check' : 'Waiting for your face to be detected'} <ChevronRight size={16} />
        </button>
        {(integrity.mediaStatus === 'denied' || integrity.mediaStatus === 'unavailable') && <p className="muted small">No camera? You can continue to the system check and request an officer-approved assisted entry there.</p>}
      </section>
    </main>
  )
}

// ---------------------------------------------------------------- readiness gate

interface CheckResult { label: string; detail: string; ok: boolean | null }

async function runPlatformChecks(state: ExamState, candidateId: string, lang: Lang): Promise<{ checks: CheckResult[]; tampered?: string }> {
  // Download → signature → time-locked key → decrypt → per-question hash, before the timer can start.
  const paper = await loadPaper(candidateId, window.sessionStorage.getItem(DOB_KEY) ?? '', state.sessionId)
  const manifestOk = paper.ok && paper.code === PAPER.code && paper.version === PAPER.version && paper.count === BLUEPRINT.length
  const langOk = paper.ok && QUESTIONS.every((q) => (q.type === 'mcq' ? q.text[lang]?.prompt && q.text[lang].options.length === 4 : q.text[lang]?.statement))

  const drift = await new Promise<number>((resolve) => {
    const started = performance.now()
    window.setTimeout(() => resolve(Math.abs(performance.now() - started - 200)), 200)
  })

  let save: CheckResult
  if (state.control.faults.saveChannelDown) save = { label: 'Answer-save channel', detail: 'Exam server rejected the save-channel handshake (simulated fault).', ok: false }
  else {
    try {
      const ms = await probeSaveChannel()
      save = { label: 'Answer-save channel', detail: `IndexedDB write → read → delete OK in ${ms} ms`, ok: true }
    } catch (error) {
      save = { label: 'Answer-save channel', detail: `Local answer store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`, ok: false }
    }
  }

  let heartbeat: CheckResult
  try {
    const started = performance.now()
    const response = await fetch(`/api/heartbeat?t=${Date.now()}`, { cache: 'no-store' })
    const ms = Math.round(performance.now() - started)
    const reachable = response.ok && apiReachable(state, candidateId)
    heartbeat = { label: 'Exam-server heartbeat', detail: reachable ? `Round trip ${ms} ms` : response.ok ? 'Exam API is in an outage for your service path.' : `Server answered HTTP ${response.status}`, ok: reachable }
  } catch {
    heartbeat = { label: 'Exam-server heartbeat', detail: 'No response from the exam server. Check your internet connection.', ok: false }
  }

  return { tampered: !paper.ok && paper.tampered ? paper.reason : undefined, checks: [
    { label: 'Signed paper', detail: paper.ok ? `${paper.code} · v${paper.version} · ${paper.count} items · ${paper.stagedAt ? `pre-loaded ${fmtTime(paper.stagedAt)} · ` : paper.replaced ? 'pre-loaded copy failed checks and was re-downloaded · ' : ''}${paper.keyReleasedAt ? `key released ${fmtTime(paper.keyReleasedAt)} · ` : ''}authority signature valid · every question matches its signed hash · fingerprint #${paper.root.slice(0, 12)}${paper.cached ? ' (verified offline copy)' : ''}` : `${paper.reason} Entry blocked.`, ok: manifestOk },
    { label: 'Language pack', detail: langOk ? `${lang === 'hi' ? 'Hindi' : 'English'} available for all ${QUESTIONS.length} items` : paper.ok ? 'Selected language is missing for some items.' : 'Waiting for a verified paper.', ok: langOk },
    { label: 'Exam timer', detail: drift < 60 ? `${fmtClock(EXAM_SECONDS)} configured · clock drift ${Math.round(drift)} ms` : `Timer drift ${Math.round(drift)} ms is too high`, ok: drift < 60 },
    save,
    heartbeat,
  ] }
}

function Gate({ api, integrity }: { api: ExamApi; integrity: Integrity }) {
  const { state } = api
  const mine = api.mine!
  const [checks, setChecks] = useState<CheckResult[]>([])
  const [running, setRunning] = useState(false)
  const lastOutcome = useRef('')
  const reportedTamper = useRef('')
  const [tamper, setTamper] = useState<{ reason: string; at: string } | null>(null)
  const faults = state.control.faults
  const assistedApproved = Boolean(state.control.assistedApproved[mine.candidateId])

  const run = useCallback(async () => {
    setRunning(true)
    const { checks: results, tampered } = await runPlatformChecks(api.state, mine.candidateId, mine.lang)
    setChecks(results)
    setTamper((previous) => (tampered ? previous ?? { reason: tampered, at: new Date().toISOString() } : null))
    if (tampered && reportedTamper.current !== tampered) {
      reportedTamper.current = tampered
      const entry = rosterEntry(mine.candidateId)
      api.recordSignal(`PAPER TAMPERED — detected on ${mine.candidateId}'s PC (${entry?.centre})`, `${tampered} The PC refused to show the paper. Signature checked against the exam authority key ${paperInfo?.keyId ?? ''}.`.trim(), 'integrity', { alert: true, action: 'paper-tampered', path: entry?.path ?? null })
    }
    setRunning(false)
    const failures = results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.detail}`)
    const outcome = failures.join('|') || 'pass'
    if (outcome !== lastOutcome.current) {
      lastOutcome.current = outcome
      api.recordGate(!failures.length, failures)
    }
  }, [api])

  // Re-run whenever the operator changes a fault or an outage starts/ends.
  const incidentKey = openIncidents(state).map((incident) => incident.id).join(',')
  useEffect(() => { void run() }, [state.control.paperTamper, faults.saveChannelDown, incidentKey, api.serverReachable]) // eslint-disable-line react-hooks/exhaustive-deps

  const platformOk = checks.length > 0 && checks.every((c) => c.ok)
  const centre = Boolean(state.control.centreMode)
  const verified = state.control.verified?.[mine.candidateId]
  const proctorOk = centre
    ? Boolean(verified) && (integrity.isFullscreen || assistedApproved)
    : (integrity.mediaStatus === 'ready' && integrity.faces === 1 && integrity.isFullscreen) || assistedApproved

  // While a check is failing, retry every 10 s; after 2 minutes without success the candidate can report it.
  const [blockedSince, setBlockedSince] = useState<number | null>(null)
  const nowMs = useNow(1000)
  useEffect(() => {
    if (!checks.length) return
    setBlockedSince((since) => (platformOk ? null : since ?? Date.now()))
    if (platformOk) return
    const timer = window.setTimeout(() => void run(), 10_000)
    return () => window.clearTimeout(timer)
  }, [checks]) // eslint-disable-line react-hooks/exhaustive-deps
  const blockedFor = blockedSince ? Math.floor((nowMs - blockedSince) / 1000) : 0
  const entry = rosterEntry(mine.candidateId)

  return (
    <main className="doc-page">
      <header className="bar"><Brand inverse /><span>{entry?.name} · {entry?.id}</span></header>
      <section className="gate">
        <div className="doc-card">
          <div className="card-head"><h1>System &amp; Session Readiness Check</h1><button className="btn ghost" onClick={() => void run()} disabled={running}><RefreshCw size={14} className={running ? 'spin' : ''} /> Re-run checks</button></div>
          <p className="muted">The timer does not start until every check passes.</p>
          <ul className="checks">
            {checks.map((check) => (
              <li key={check.label} className={check.ok ? 'ok' : 'bad'}>
                {check.ok ? <Check size={16} /> : <XCircle size={16} />}
                <span><b>{check.label}</b><small>{check.detail}</small></span>
              </li>
            ))}
            {!checks.length && <li><Loader2 size={16} className="spin" /> Running checks…</li>}
          </ul>
          {tamper && (
            <div className="tamper-box" role="alert">
              <b><ShieldAlert size={16} /> The question paper for your centre failed the security check</b>
              <p>It was <b>not shown to you</b>, and the exam office was alerted automatically at {fmtTime(tamper.at)}. <b>Your {EXAM_SECONDS / 60} minutes have not started</b> — you get the full time once a verified paper arrives (this page checks every 10 seconds).</p>
              <p>If it cannot be fixed, the exam officer will release you with a re-exam; at the latest you can report it when the window closes at {fmtTime(new Date(windowEndsAt(state)).toISOString())}. Please stay seated and follow the invigilator.</p>
            </div>
          )}
          {!platformOk && checks.length > 0 && !tamper && <p className="error-text"><AlertTriangle size={14} /> Entry is blocked because a platform check failed. This is not your fault — your exam time has not started. Retrying every 10 seconds{blockedFor ? ` (blocked for ${fmtClock(blockedFor)})` : ''}.</p>}
          {blockedFor >= 120 && (
            <div className="report-box">
              <p className="muted small">Still unable to start after 2 minutes. If the problem continues, report it — the report is saved on this device and reaches the exam office as soon as a connection is available. If the platform's records confirm it, you will get a re-exam.</p>
              <button className="btn primary wide" onClick={() => api.reportAffected(tamper ? 'I could not start the exam: the question paper at my centre failed the security check.' : 'I could not start the exam: the system check kept failing (no connection to the exam server).')}><AlertTriangle size={16} /> Report — I cannot take this exam</button>
            </div>
          )}
        </div>

        <div className="doc-card">
          <h2>{centre ? 'Seat check' : 'Proctoring setup'}</h2>
          {centre && (verified
            ? <Pill tone="good"><BadgeCheck size={13} /> Identity verified at {seatLabel(rosterEntry(mine.candidateId))} by {verified.by} · {fmtTime(verified.at)}</Pill>
            : <p className="callout"><Loader2 size={14} className="spin" /> Raise your hand: the invigilator must verify your admit card and photo ID at <b>{seatLabel(rosterEntry(mine.candidateId))}</b> before you can start.</p>)}
          {!centre && <CameraCheck integrity={integrity} />}
          {!integrity.isFullscreen && !assistedApproved && <button className="btn" onClick={() => void integrity.requestFullscreen()}><Maximize size={15} /> Enter fullscreen</button>}
          {proctorOk && !assistedApproved && <Pill tone="good"><BadgeCheck size={13} /> Camera, face and fullscreen ready</Pill>}
          <button className="link-btn" onClick={api.requestAssisted} disabled={mine.assistedRequested}>
            {assistedApproved ? 'Assisted entry approved by officer' : mine.assistedRequested ? 'Assisted review requested — waiting for officer' : 'Cannot use camera or fullscreen? Request assisted review'}
          </button>
          <button className="btn primary wide" disabled={!platformOk || !proctorOk} onClick={() => { api.startExam(); if (!integrity.isFullscreen && !assistedApproved) void integrity.requestFullscreen() }}>
            {platformOk && proctorOk ? 'Start exam' : centre && !verified ? 'Waiting for the invigilator' : 'Complete all checks to start'} <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------- exam

type Status = 'not-visited' | 'not-answered' | 'answered' | 'marked' | 'answered-marked'

function statusOf(responses: CandidateSlice['responses'], question: Question): Status {
  const response = responses[question.id]
  const answered = response?.answer !== undefined
  if (response?.marked) return answered ? 'answered-marked' : 'marked'
  if (answered) return 'answered'
  return response?.visited ? 'not-answered' : 'not-visited'
}

function Exam({ api, integrity, aiCheck, aiEnabled }: { api: ExamApi; integrity: Integrity; aiCheck: (reason?: string) => Promise<void>; aiEnabled: boolean }) {
  const { state } = api
  const candidate = api.mine!
  const nowMs = useNow(500)
  const question = questionById(candidate.current)
  const lang = candidate.lang
  const entry = rosterEntry(candidate.candidateId)
  const remaining = remainingSeconds(state, candidate.candidateId, nowMs)
  const [warning, setWarning] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [focused, setFocused] = useState(() => document.hasFocus())
  const wasFullscreen = useRef(integrity.isFullscreen)
  const hiddenAt = useRef<number | null>(null)
  const tabTimer = useRef<number | undefined>(undefined)
  // Messages from the exam office (manual announcements and automatic incident notices).
  const inbox = messagesFor(state, candidate.candidateId).filter((message) => message.at >= candidate.loggedInAt)
  const seenMessages = useRef(inbox.length)
  const [banner, setBanner] = useState<string | null>(null)
  useEffect(() => {
    if (inbox.length > seenMessages.current) setBanner(inbox[inbox.length - 1].text)
    seenMessages.current = inbox.length
  }, [inbox.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const seenSwitches = useRef(candidate.tabSwitches ?? 0)
  useEffect(() => {
    const count = candidate.tabSwitches ?? 0
    if (count > seenSwitches.current && count === 1) setWarning('You left the exam tab. This is your first and only warning — the next time the paper locks for 10 minutes. The exam officer has been notified.')
    seenSwitches.current = count
  }, [candidate.tabSwitches])

  const myIncidents = state.control.incidents.filter((incident) => incident.affected.includes(candidate.candidateId))
  const openOutage = candidate.outages.find((outage) => !outage.to)
  const pending = myIncidents.find((incident) => !incident.decision)
  const latestDecided = [...myIncidents].reverse().find((incident) => incident.decision)
  const index = QUESTIONS.findIndex((q) => q.id === question.id)

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? '' : current)), 3500)
  }, [])

  // Auto-submit at time-up (works offline too: the submission syncs when the connection returns).
  useEffect(() => {
    if (remaining <= 0) void api.submit('time-up')
  }, [remaining, api])

  useEffect(() => {
    if (myIncidents.some((incident) => incident.decision?.policy === 'reschedule')) void api.submit('reschedule')
  }, [myIncidents, api])

  // Fullscreen exit → warning modal (recorded, never auto-terminated).
  useEffect(() => {
    if (wasFullscreen.current && !integrity.isFullscreen) {
      if (state.control.assistedApproved[candidate.candidateId]) {
        integrity.signal('Exited fullscreen during exam', 'Candidate is on an officer-approved assisted path, so no warning was shown. Review-only.')
      } else {
        api.addWarning()
        integrity.signal('Exited fullscreen during exam', `Warning ${candidate.warnings + 1} shown to candidate. Review-only.`)
        setWarning('You left fullscreen mode. This has been recorded. Return to fullscreen to continue.')
      }
    }
    wasFullscreen.current = integrity.isFullscreen
  }, [integrity.isFullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tab switch / window focus.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now()
        // Ignore sub-2-second flickers (OS popups, notifications); a real switch counts.
        window.clearTimeout(tabTimer.current)
        tabTimer.current = window.setTimeout(() => { if (document.hidden) api.tabSwitch() }, 2000)
        return
      }
      window.clearTimeout(tabTimer.current)
      if (hiddenAt.current) {
        const seconds = Math.round((Date.now() - hiddenAt.current) / 1000)
        hiddenAt.current = null
        integrity.signal('Exam tab visible again', `Returned after ${seconds}s.${seconds < 2 ? ' Too short to count as a tab switch.' : ''}`, 'integrity', { awaySeconds: seconds })
        if (aiEnabled && integrity.mediaStatus === 'ready') void aiCheck('tab-return')
      }
    }
    const onBlur = () => {
      setFocused(false)
      window.setTimeout(() => { if (!document.hidden && !document.hasFocus()) integrity.signal('Exam window lost focus', 'Another window or app took focus while the exam stayed visible.') }, 400)
    }
    const onFocus = () => setFocused(true)
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        setReveal(true)
      }
      if (event.key === 'PrintScreen') integrity.signal('PrintScreen key pressed', 'Browsers cannot block OS screenshots; recorded for review.')
      // Clipboard shortcuts anywhere outside the code editor (the editor has its own paste rule).
      if ((event.target as HTMLElement | null)?.closest?.('.code-shell')) return
      const key = event.key.toLowerCase()
      const mod = event.metaKey || event.ctrlKey
      const action = (mod && key === 'c') || (event.ctrlKey && key === 'insert') ? 'copy' : (mod && key === 'x') || (event.shiftKey && key === 'delete') ? 'cut' : (mod && key === 'v') || (event.shiftKey && key === 'insert') ? 'paste' : null
      if (!action) return
      event.preventDefault()
      integrity.signal(`Protected content ${action} blocked`, `A ${action} shortcut was pressed during the exam and prevented. Review-only.`)
      flash(`${action[0].toUpperCase()}${action.slice(1)} is disabled during the exam. This was recorded.`)
    }
    const onClipboard = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.('.code-shell, .shield')) return
      event.preventDefault()
      integrity.signal(`Protected content ${event.type} blocked`, `A ${event.type} via browser menu was prevented. Review-only.`)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKey)
    document.addEventListener('copy', onClipboard)
    document.addEventListener('cut', onClipboard)
    return () => {
      document.removeEventListener('copy', onClipboard)
      document.removeEventListener('cut', onClipboard)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKey)
    }
  }, [api, integrity, aiCheck, aiEnabled])

  useEffect(() => {
    if (!reveal) return
    api.recordSignal('BlurShield wide reveal used', 'Accessible 15-second reading lens (watermark kept).', 'access')
    const timer = window.setTimeout(() => setReveal(false), 15_000)
    return () => window.clearTimeout(timer)
  }, [reveal]) // eslint-disable-line react-hooks/exhaustive-deps

  const codeRef = useRef<CodeDraft | undefined>(undefined)
  const savedCode = useRef<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const isLast = index === QUESTIONS.length - 1

  // Coding answers live in the editor; Save/Mark checkpoints them if they changed since the last checkpoint.
  const persistCode = async () => {
    if (question.type !== 'coding') return
    const draft = codeRef.current
    const key = draft && `${draft.lang}:${draft.code}`
    if (!draft || draft.code === question.templates[draft.lang].code || savedCode.current[question.id] === key) return
    savedCode.current[question.id] = key!
    const response = candidate.responses[question.id]
    const same = response?.code === draft.code && response?.codeLang === draft.lang
    await api.saveAnswer(question.id, response?.tests && same ? response.answer : 'code saved (not evaluated)', { code: draft.code, codeLang: draft.lang, tests: same ? response?.tests : undefined })
  }

  const saveAndNext = async () => {
    await persistCode()
    api.setMarked(question.id, false)
    if (isLast) setConfirmSubmit(true)
    else go(1)
  }

  const markAndNext = async () => {
    await persistCode()
    api.setMarked(question.id, true)
    if (!isLast) go(1)
  }

  const finish = async () => {
    if (submitting) return
    setSubmitting(true)
    await persistCode()
    await api.submit('candidate')
  }

  const go = (offset: number) => {
    const next = QUESTIONS[Math.min(QUESTIONS.length - 1, Math.max(0, index + offset))]
    api.goTo(next.id)
  }

  const counts = useMemo(() => {
    const result: Record<Status, number> = { 'not-visited': 0, 'not-answered': 0, answered: 0, marked: 0, 'answered-marked': 0 }
    QUESTIONS.forEach((q) => { result[statusOf(candidate.responses, q)] += 1 })
    return result
  }, [candidate.responses])

  const offline = Boolean(openOutage) || !api.serverReachable
  const offlineTotal = Math.round(offlineSeconds(candidate, nowMs))
  const lock = lockState(state, candidate.candidateId, nowMs)
  const locked = lock !== 'none'
  const lockLeft = lock === 'locked' ? Math.max(0, Math.round((Date.parse(candidate.lockedUntil!) - nowMs) / 1000)) : 0
  const assisted = Boolean(state.control.assistedApproved[candidate.candidateId])
  const needsProctoring = !assisted && !locked && ((!state.control.centreMode && integrity.mediaStatus !== 'ready') || !integrity.isFullscreen)
  const savedCount = Object.values(candidate.responses).filter((response) => response.answer !== undefined).length
  const queuedCount = state.checkpoints.filter((c) => c.candidateId === candidate.candidateId && c.status === 'queued').length

  return (
    <main className={`exam ${offline ? 'is-offline' : ''}`}>
      <header className="exam-head">
        <Brand />
        <div className="exam-title"><b>{PAPER.title}</b><small>{PAPER.code} · v{PAPER.version}{paperInfo ? ` · signed #${paperInfo.root.slice(0, 8)}` : ''}</small></div>
        <div className={`timer ${remaining < 300 ? 'low' : ''}`} aria-live="off"><Clock3 size={16} /><span><small>Time left</small><b>{fmtClock(remaining)}</b></span></div>
        {offlineTotal > 0 && <div className={`timer offline ${offline ? 'live' : ''}`} aria-live="off"><WifiOff size={16} /><span><small>{offline ? 'Offline now' : 'Offline total'}</small><b>{fmtClock(offlineTotal)}</b></span></div>}
        <div className="who">
          <div className={`thumb ${integrity.obstructed ? 'bad' : ''}`}>
            <video ref={integrity.attachVideo} autoPlay muted playsInline aria-label="Your camera" />
            {integrity.mediaStatus !== 'ready' && <Camera size={16} />}
          </div>
          <span><b>{entry?.name}</b><small>{entry?.id}</small></span>
        </div>
      </header>

      <nav className="exam-bar">
        <div className="tabs" role="tablist">
          {SECTIONS.map((section) => {
            const first = QUESTIONS.find((q) => q.section === section.id)!
            return <button key={section.id} role="tab" aria-selected={question.section === section.id} className={question.section === section.id ? 'active' : ''} onClick={() => api.goTo(first.id)}>{section.name[lang]}</button>
          })}
        </div>
        <div className="bar-status">
          <Pill tone={offline ? 'bad' : 'good'}>{offline ? <WifiOff size={12} /> : <Wifi size={12} />} {offline ? 'Offline — saving on device' : queuedCount ? `Syncing ${queuedCount}…` : 'Connected · synced'}</Pill>
          <Pill tone={integrity.mediaStatus === 'ready' && !integrity.obstructed ? 'good' : 'warn'}><Camera size={12} /> {integrity.mediaStatus !== 'ready' ? 'Camera off' : integrity.obstructed ? 'Camera covered' : 'Proctored'}</Pill>
          {integrity.mediaStatus === 'ready' && integrity.faces !== null && <Pill tone={integrity.faces === 1 ? 'good' : 'bad'}>{integrity.faces === 1 ? '1 face' : integrity.faces === 0 ? 'No face' : `${integrity.faces} faces`}</Pill>}
          <Pill tone={!aiEnabled ? 'neutral' : candidate.ai?.error ? 'warn' : candidate.ai?.risk && candidate.ai.risk !== 'none' ? 'warn' : 'good'}><Bot size={12} /> {!aiEnabled ? 'AI proctor off' : candidate.ai?.error ? 'AI retrying' : `AI checks ${candidate.ai?.checks ?? 0}`}</Pill>
          <label className="lang">Language
            <select value={lang} onChange={(e) => api.setLang(e.target.value as Lang)}><option value="en">English</option><option value="hi">हिन्दी</option></select>
          </label>
        </div>
      </nav>

      {notice && <div className="toast" role="status">{notice}</div>}
      {banner && <div className="banner message" role="status" aria-live="polite"><Megaphone size={16} /> <b>Exam office:</b> {banner}<button className="link-btn" onClick={() => setBanner(null)}>Dismiss</button></div>}
      {offline && <div className="banner offline" role="status" aria-live="polite"><WifiOff size={16} /> No connection to the exam server. Keep answering — every answer is saved on this device ({queuedCount} waiting) and syncs automatically when the internet returns. Offline for {fmtClock(offlineTotal)}.</div>}
      <IncidentBanner candidate={candidate} pending={pending} latest={latestDecided} onReceipt={setReceipt} />

      {/* inert only while locked for a tab switch; offline the candidate keeps working */}
      <div className="exam-body" {...(locked ? { inert: '' } : {})}>
        <section className="qpanel">
          <div className="qmeta">
            <b>Question {index + 1} of {QUESTIONS.length}</b>
            <span>{SECTIONS.find((s) => s.id === question.section)?.name[lang]} · Marks {question.type === 'coding' ? '+10' : '+2 / −0'}</span>
          </div>
          {question.type === 'mcq'
            ? <McqView key={question.id} question={question} lang={lang} state={state} candidate={candidate} api={api} reveal={reveal} focused={focused} onBlocked={flash} integrity={integrity} />
            : <CodingView key={question.id} codeRef={codeRef} onCheckpoint={(key) => { savedCode.current[question.id] = key }} question={question} lang={lang} state={state} candidate={candidate} api={api} reveal={reveal} focused={focused} onBlocked={flash} integrity={integrity} />}
          <footer className="qactions">
            <button className="btn" onClick={() => void markAndNext()}><Flag size={15} /> Mark for Review{isLast ? '' : ' & Next'}</button>
            <button className="btn" onClick={() => void api.saveAnswer(question.id, undefined, { tests: undefined })} disabled={candidate.responses[question.id]?.answer === undefined}>Clear Response</button>
            <span className="spacer" />
            <button className="btn" onClick={() => go(-1)} disabled={index === 0}><ChevronLeft size={15} /> Previous</button>
            <button className="btn primary" onClick={() => void saveAndNext()}>{isLast ? 'Save & Finish' : 'Save & Next'} <ChevronRight size={15} /></button>
          </footer>
        </section>

        <aside className="palette">
          <ul className="legend">
            <li><i className="st answered" />{counts.answered} Answered</li>
            <li><i className="st not-answered" />{counts['not-answered']} Not answered</li>
            <li><i className="st not-visited" />{counts['not-visited']} Not visited</li>
            <li><i className="st marked" />{counts.marked} Marked</li>
            <li><i className="st answered-marked" />{counts['answered-marked']} Answered &amp; marked</li>
          </ul>
          {SECTIONS.map((section) => (
            <div key={section.id} className="pal-section">
              <small>{section.name[lang]}</small>
              <div className="pal-grid">
                {QUESTIONS.filter((q) => q.section === section.id).map((q) => (
                  <button key={q.id} className={`st ${statusOf(candidate.responses, q)} ${q.id === question.id ? 'current' : ''}`} onClick={() => api.goTo(q.id)} aria-label={`Question ${QUESTIONS.indexOf(q) + 1}, ${statusOf(candidate.responses, q).replace('-', ' ')}`}>
                    {QUESTIONS.indexOf(q) + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="integrity-box">
            <b><ShieldAlert size={14} /> Proctoring</b>
            {integrity.mediaStatus !== 'ready' && <button className="btn small" onClick={() => void integrity.requestMedia()}><Camera size={13} /> Reconnect camera</button>}
            {!integrity.isFullscreen && !state.control.assistedApproved[candidate.candidateId] && <button className="btn small" onClick={() => void integrity.requestFullscreen()}><Maximize size={13} /> Return to fullscreen</button>}
            <small>Warnings recorded: {candidate.warnings}</small>
            {inbox.length > 0 && <div className="inbox"><b><Megaphone size={13} /> From the exam office</b>{inbox.slice(-3).reverse().map((message) => <small key={message.id}>{fmtTime(message.at)} — {message.text}</small>)}</div>}
            {aiEnabled && <small>AI proctor: {candidate.ai?.error ? 'check temporarily unavailable — your exam is not affected' : `active · ${candidate.ai?.checks ?? 0} checks`}</small>}
            <small>{savedCount} answer(s) saved · {state.checkpoints.filter((c) => c.candidateId === candidate.candidateId).length} checkpoints</small>
            {latestDecided?.decision?.receipts[candidate.candidateId] && <button className="btn small" onClick={() => setReceipt(latestDecided.decision!.receipts[candidate.candidateId])}><ReceiptText size={13} /> Fairness receipt</button>}
          </div>
          <button className="btn submit" onClick={() => void persistCode().then(() => setConfirmSubmit(true))}><Send size={15} /> Submit Test</button>
        </aside>
      </div>

      {locked && (
        <div className="outage-overlay" role="alertdialog" aria-live="assertive" aria-label="Exam locked for tab switching">
          <div>
            <LockKeyhole size={34} />
            {lock === 'locked' ? (
              <>
                <h2>Paper locked for switching tabs</h2>
                <p>You left the exam tab a second time. The paper is locked for {TAB_LOCK_MINUTES} minutes and <b>the exam timer keeps running.</b></p>
                <p className="big">{fmtClock(lockLeft)}</p>
                <p className="muted">The exam officer has been alerted. <b>A third switch suspends your exam</b> until the officer decides.</p>
              </>
            ) : (
              <>
                <h2>Exam suspended</h2>
                <p>You left the exam tab {candidate.tabSwitches} times. Your answers are saved. The exam officer is reviewing and will either <b>resume</b> or <b>cancel</b> your attempt.</p>
                <p className="muted"><Loader2 size={13} className="spin" /> Waiting for the officer's decision…</p>
              </>
            )}
          </div>
        </div>
      )}

      {needsProctoring && (
        <div className="modal-backdrop">
          <section className="modal small" role="alertdialog" aria-labelledby="proctor-title">
            <Camera size={28} className="warn-icon" />
            <h2 id="proctor-title">Proctoring required</h2>
            <p>{warning ?? 'Camera, microphone and fullscreen must stay on for the whole exam.'}</p>
            <p className="muted small">Camera {integrity.mediaStatus === 'ready' ? 'on' : 'off'} · Fullscreen {integrity.isFullscreen ? 'on' : 'off'}{integrity.mediaStatus === 'denied' ? ' — allow camera access in the address bar' : ''}</p>
            <button className="btn primary" onClick={() => { setWarning(null); if (!integrity.isFullscreen) void integrity.requestFullscreen(); if (integrity.mediaStatus !== 'ready') void integrity.requestMedia() }}>Turn on camera &amp; fullscreen</button>
          </section>
        </div>
      )}

      {warning && !locked && !needsProctoring && (
        <div className="modal-backdrop">
          <section className="modal small" role="alertdialog" aria-labelledby="warn-title">
            <CircleAlert size={28} className="warn-icon" />
            <h2 id="warn-title">Warning {candidate.warnings}</h2>
            <p>{warning}</p>
            <p className="muted small">Warnings are reviewed by an exam officer. Your exam is not terminated automatically.</p>
            <button className="btn primary" onClick={() => { setWarning(null); if (!integrity.isFullscreen && !state.control.assistedApproved[candidate.candidateId]) void integrity.requestFullscreen() }}>Continue exam</button>
          </section>
        </div>
      )}

      {confirmSubmit && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-labelledby="submit-title">
            <h2 id="submit-title">Submit your test?</h2>
            <table className="table">
              <thead><tr><th>Section</th><th>Answered</th><th>Not answered</th><th>Marked</th><th>Not visited</th></tr></thead>
              <tbody>
                {SECTIONS.map((section) => {
                  const list = QUESTIONS.filter((q) => q.section === section.id).map((q) => statusOf(candidate.responses, q))
                  return <tr key={section.id}><td>{section.name[lang]}</td><td>{list.filter((s) => s === 'answered' || s === 'answered-marked').length}</td><td>{list.filter((s) => s === 'not-answered').length}</td><td>{list.filter((s) => s === 'marked' || s === 'answered-marked').length}</td><td>{list.filter((s) => s === 'not-visited').length}</td></tr>
                })}
              </tbody>
            </table>
            <p className="muted">Time left {fmtClock(remaining)}. You cannot change answers after submitting.</p>
            <footer><button className="btn" onClick={() => setConfirmSubmit(false)}>Go back</button><button className="btn primary" disabled={submitting} onClick={() => void finish()}>{submitting ? 'Submitting…' : 'Yes, submit'}</button></footer>
          </section>
        </div>
      )}

      {receipt && <ReceiptModal receipt={receipt} state={state} onClose={() => setReceipt(null)} />}
    </main>
  )
}

function IncidentBanner({ candidate, pending, latest, onReceipt }: { candidate: CandidateSlice; pending?: ExamState['control']['incidents'][number]; latest?: ExamState['control']['incidents'][number]; onReceipt: (receipt: Receipt) => void }) {
  if (pending?.restoredAt || (pending && !candidate.outages.some((o) => !o.to))) {
    return <div className="banner info"><RefreshCw size={16} /> Connection restored — all answers you gave offline have synced. {pending.id} is being reviewed by the exam office.</div>
  }
  if (latest?.decision && !pending) {
    const decision = latest.decision
    const credit = decision.credits[candidate.candidateId] ?? 0
    const receipt = decision.receipts[candidate.candidateId]
    return (
      <div className="banner good">
        <BadgeCheck size={16} /> {latest.id}: {decision.policy === 'reschedule' ? 'targeted reschedule approved' : credit ? `${credit}s extra time added` : 'you kept answering offline and everything synced, so no time was lost'} ({decision.auto ? 'auto-applied' : 'officer approved'}).
        {receipt && <button className="link-btn" onClick={() => onReceipt(receipt)}>View Fairness Receipt</button>}
      </div>
    )
  }
  return null
}

// ---------------------------------------------------------------- BlurShield wrapper

function Shielded({ children, state, reveal, focused, onBlocked, integrity, className = '' }: {
  children: React.ReactNode; state: { me: string; sessionId: string }; reveal: boolean; focused: boolean; onBlocked: (message: string) => void; integrity: Integrity; className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const nowMs = useNow(10_000)
  const stamp = `${state.me} · ${state.sessionId.slice(-6).toUpperCase()} · ${fmtTime(new Date(nowMs).toISOString())}`
  const shift = Math.floor(nowMs / 10_000) % 4

  const block = (action: string) => {
    integrity.signal(`Protected content ${action} blocked`, `A ${action} attempt inside the question layer was prevented. Review-only.`)
    onBlocked(`${action[0].toUpperCase()}${action.slice(1)} is disabled for exam content. This was recorded.`)
  }
  const moveSpot = (x: number, y: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    ref.current!.style.setProperty('--spot-x', `${((x - rect.left) / rect.width) * 100}%`)
    ref.current!.style.setProperty('--spot-y', `${((y - rect.top) / rect.height) * 100}%`)
  }

  return (
    <div
      ref={ref}
      className={`shield ${reveal ? 'reveal' : ''} ${focused ? '' : 'defocused'} ${className}`}
      onMouseMove={(e) => moveSpot(e.clientX, e.clientY)}
      onFocusCapture={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); moveSpot(r.left + Math.min(r.width / 2, 160), r.top + r.height / 2) }}
      onCopy={(e) => { e.preventDefault(); block('copy') }}
      onCut={(e) => { e.preventDefault(); block('cut') }}
      onContextMenu={(e) => { e.preventDefault(); block('right-click') }}
      onDragStart={(e) => { e.preventDefault(); block('drag') }}
    >
      <div className={`watermark shift-${shift}`} aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>{stamp}</span>)}</div>
      <div className="shield-content">{children}</div>
      <div className="shield-blur" aria-hidden="true" />
      <span className="shield-hint"><Eye size={12} /> BlurShield · move pointer or Tab to read · Alt+R wide lens{reveal ? ' (on)' : ''}</span>
    </div>
  )
}

interface ViewProps { lang: Lang; state: ExamState; candidate: CandidateSlice; api: ExamApi; reveal: boolean; focused: boolean; onBlocked: (m: string) => void; integrity: Integrity }

function McqView({ question, lang, state, candidate, api, ...shield }: ViewProps & { question: McqQuestion }) {
  const text = question.text[lang]
  const selected = candidate.responses[question.id]?.answer
  return (
    <div className={`qcontent ${question.reference ? 'with-ref' : ''}`}>
      <Shielded state={{ me: candidate.candidateId, sessionId: state.sessionId }} {...shield}>
        <p className="prompt">{text.prompt}</p>
        <fieldset className="options">
          <legend className="sr-only">Options</legend>
          {(question.order ?? text.options.map((_, i) => i)).map((canonical, i) => {
            // Shown letters follow this candidate's shuffle; the saved answer is the canonical option.
            const key = String.fromCharCode(65 + canonical)
            const shown = String.fromCharCode(65 + i)
            return (
              <label key={key} className={selected === key ? 'selected' : ''}>
                <input type="radio" name={question.id} value={shown} checked={selected === key} onChange={() => void api.saveAnswer(question.id, key)} />
                <span className="opt-key">{shown}</span><span>{text.options[canonical]}</span>
              </label>
            )
          })}
        </fieldset>
      </Shielded>
      {question.reference === 'binary-tree' && <BinaryTree />}
    </div>
  )
}

function CodingView({ question, lang, state, candidate, api, codeRef, onCheckpoint, ...shield }: ViewProps & { question: CodingQuestion; codeRef: React.MutableRefObject<CodeDraft | undefined>; onCheckpoint: (key: string) => void }) {
  const text = question.text[lang]
  const response = candidate.responses[question.id]
  const savedLang = (response?.codeLang as CodeLang | undefined) ?? 'js'
  const [codeLang, setCodeLang] = useState<CodeLang>(savedLang)
  const [drafts, setDrafts] = useState<Record<CodeLang, string>>(() => ({
    js: question.templates.js.code,
    py: question.templates.py.code,
    ...(response?.code ? { [savedLang]: response.code } : {}),
  }))
  const code = drafts[codeLang]
  const template = question.templates[codeLang]
  codeRef.current = { code, lang: codeLang }
  const [results, setResults] = useState<CaseResult[] | null>(null)
  const [running, setRunning] = useState<'run' | 'submit' | null>(null)
  const copied = useRef('')
  const setCode = (value: string) => setDrafts((current) => ({ ...current, [codeLang]: value }))

  // Debounced draft save so a reload never loses code.
  useEffect(() => {
    if (code === template.code || (code === response?.code && codeLang === savedLang)) return
    const timer = window.setTimeout(() => api.updateResponse(question.id, { code, codeLang }), 800)
    return () => window.clearTimeout(timer)
  }, [code, codeLang]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (mode: 'run' | 'submit') => {
    setRunning(mode)
    setResults(null)
    const cases = mode === 'run' ? question.samples : [...question.samples, ...question.hidden]
    const outcome = await runCases(codeLang, `${code}\n\n${template.driver}\n`, cases)
    setResults(outcome)
    setRunning(null)
    if (mode === 'submit') {
      const passed = outcome.filter((r) => r.passed).length
      onCheckpoint(`${codeLang}:${code}`)
      await api.saveAnswer(question.id, `${passed}/${outcome.length} tests (${CODE_LANGS[codeLang]})`, { code, codeLang, tests: { passed, total: outcome.length } })
    }
  }

  return (
    <div className="coding">
      <Shielded state={{ me: candidate.candidateId, sessionId: state.sessionId }} {...shield} className="statement">
        <h3>{text.title}</h3>
        <p>{text.statement}</p>
        <p><b>Input:</b> {text.input}</p>
        <p><b>Output:</b> {text.output}</p>
        {question.samples.map((sample, i) => (
          <div key={i} className="sample"><small>Sample {i + 1} · input</small><pre>{sample.input}</pre><small>Expected output</small><pre>{sample.output}</pre></div>
        ))}
      </Shielded>
      <div className="editor">
        <div className="editor-bar">
          <select aria-label="Programming language" value={codeLang} onChange={(e) => { setCodeLang(e.target.value as CodeLang); setResults(null) }}>
            {(Object.keys(CODE_LANGS) as CodeLang[]).map((key) => <option key={key} value={key}>{CODE_LANGS[key]}</option>)}
          </select>
          <button className="btn small ghost" onClick={() => setCode(template.code)} disabled={code === template.code}>Reset to template</button>
          <span className="spacer" />
          {response?.tests && <Pill tone={response.tests.passed === response.tests.total ? 'good' : 'warn'}>Last submit {response.tests.passed}/{response.tests.total}</Pill>}
        </div>
        <div className="code-shell">
          <div className="code-file">{codeLang === 'py' ? 'solution.py' : 'solution.js'}</div>
          <textarea
            value={code}
            spellCheck={false}
            aria-label="Code editor"
            onChange={(e) => setCode(e.target.value)}
            onCopy={() => { copied.current = window.getSelection()?.toString() ?? '' }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (pasted && pasted !== copied.current) {
                e.preventDefault()
                shield.integrity.signal('External paste into code editor blocked', `${pasted.length} characters from outside the editor were rejected.`)
                shield.onBlocked('Pasting code from outside the editor is disabled. This was recorded.')
              }
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Tab') return
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: start, selectionEnd: end } = el
              const indent = codeLang === 'py' ? '    ' : '  '
              setCode(`${code.slice(0, start)}${indent}${code.slice(end)}`)
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + indent.length })
            }}
          />
          <details className="driver">
            <summary>Driver code (read-only) — reads input, calls your function, prints the result</summary>
            <pre>{template.driver}</pre>
          </details>
        </div>
        <div className="editor-actions">
          <button className="btn" onClick={() => void run('run')} disabled={Boolean(running)}>{running === 'run' ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run samples</button>
          <button className="btn primary" onClick={() => void run('submit')} disabled={Boolean(running)}>{running === 'submit' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Submit code</button>
          {running && codeLang === 'py' && !pythonLoaded() && <small>Loading Python runtime (first run only)…</small>}
        </div>
        {results && (
          <ul className="results">
            {results.map((result, i) => (
              <li key={i} className={result.passed ? 'ok' : 'bad'}>
                <b>{i < question.samples.length ? `Sample ${i + 1}` : `Hidden test ${i - question.samples.length + 1}`}: {result.passed ? 'Passed' : 'Failed'}</b> <small>{result.ms} ms</small>
                {!result.passed && i < question.samples.length && <pre>{result.error ? `Error: ${result.error}` : `Got: ${result.output || '(no output)'}\nExpected: ${result.expected}`}</pre>}
                {!result.passed && i >= question.samples.length && result.error && <pre>Error: {result.error}</pre>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- signed in elsewhere

function OtherDevice({ api }: { api: ExamApi }) {
  const entry = rosterEntry(api.me ?? undefined)
  return (
    <main className="doc-page">
      <header className="bar"><Brand inverse /><span>{entry?.name} · {entry?.id}</span></header>
      <section className="doc-card affected">
        <LockKeyhole size={40} className="warn-icon" />
        <h1>Signed in on another device</h1>
        <p className="muted">This attempt is now running on {api.mine?.device ?? 'another device'}. An exam can only be open on one device at a time, so this browser was signed out. Your answers are safe and the exam officer has been notified.</p>
        <button className="btn primary" onClick={api.logout}>Sign in again on this device</button>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------- could not take the exam

function Affected({ api }: { api: ExamApi }) {
  const { state } = api
  const candidate = api.mine!
  const entry = rosterEntry(candidate.candidateId)
  const reexam = state.control.reexams?.[candidate.candidateId]
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const tampered = state.audit.some((item) => item.candidateId === candidate.candidateId && item.data?.action === 'paper-tampered')
  const [reason, setReason] = useState(candidate.startedAt
    ? 'My connection to the exam server was lost and did not come back before the exam window closed.'
    : tampered ? 'I could not start the exam because the question paper at my centre failed the security check.'
    : 'I could not start the exam because the system check kept failing (no connection to the exam server).')
  const answered = Object.values(candidate.responses).filter((response) => response.answer !== undefined).length
  const title = reexam?.status === 'granted' ? 'Re-exam granted — only for you'
    : reexam?.status === 'rejected' ? 'Your report was reviewed'
    : candidate.report ? 'Report submitted' : 'The exam window has closed'

  return (
    <main className="doc-page">
      <header className="bar"><Brand inverse /><span>{entry?.name} · {entry?.id}</span></header>
      <section className="doc-card affected">
        {reexam?.status === 'granted' ? <BadgeCheck size={40} className="good-icon" /> : <WifiOff size={40} className="warn-icon" />}
        <h1>{title}</h1>
        {!candidate.report && !reexam && (
          <p className="muted">You could not take this exam because your session was disconnected{candidate.startedAt ? '' : ' before it could start'}, and the exam window closed at {fmtTime(new Date(windowEndsAt(state)).toISOString())}. The paper stays locked for this attempt. {answered ? `${answered} answer(s) you saved before the interruption are preserved.` : ''}</p>
        )}
        {candidate.report && !reexam && (
          <p className="muted">Reported at {fmtTime(candidate.report.at)}. {api.serverReachable && api.syncConnected
            ? 'The exam office is checking the platform records for your session now.'
            : 'You are offline: the report is saved on this device and will reach the exam office automatically as soon as your connection returns. Keep this page open.'}</p>
        )}
        {reexam?.status === 'granted' && (
          <>
            <p className="muted">{reexam.auto ? 'The platform confirmed from its own records' : `${reexam.officer} confirmed`} that your session was affected. You get a fresh attempt in a new slot; no other candidate's exam is changed. Your saved answers from this attempt are kept on record.</p>
            <ul className="evidence">{reexam.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            {reexam.receipt && <button className="btn" onClick={() => setReceipt(reexam.receipt!)}><ReceiptText size={15} /> Fairness Receipt {reexam.receipt.id}</button>}
          </>
        )}
        {reexam?.status === 'rejected' && <p className="muted">{reexam.officer}: {reexam.reason}</p>}
        {!candidate.report && !reexam && (
          <div className="report-box">
            <label>What happened?<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button className="btn primary wide" disabled={!reason.trim()} onClick={() => api.reportAffected(reason.trim())}><AlertTriangle size={16} /> Report — I could not take this exam</button>
          </div>
        )}
      </section>
      {receipt && <ReceiptModal receipt={receipt} state={state} onClose={() => setReceipt(null)} />}
    </main>
  )
}

// ---------------------------------------------------------------- submitted

function ConfirmIssues({ items, lang, onConfirm }: { items: ReportItem[]; lang: Lang; onConfirm: (answers: Record<string, { answer: 'yes' | 'no'; note?: string }>) => void }) {
  const [answers, setAnswers] = useState<Record<string, { answer?: 'yes' | 'no'; note?: string }>>({})
  const done = items.every((item) => answers[item.key]?.answer)
  const set = (key: string, patch: { answer?: 'yes' | 'no'; note?: string }) => setAnswers((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  const hi = lang === 'hi'
  const t = {
    title: hi ? 'समाप्त करने से पहले: कृपया पुष्टि करें कि क्या हुआ था' : 'Before you finish: please confirm what happened',
    intro: hi ? 'परीक्षा के दौरान प्लेटफ़ॉर्म ने नीचे दी गई बातें दर्ज कीं। आपके उत्तर आपकी रिपोर्ट के साथ परीक्षा कार्यालय को भेजे जाएँगे और बाद में बदले नहीं जा सकेंगे।' : 'The platform recorded the following during your exam. Your answers are sent to the exam office with your report and cannot be changed later.',
    yes: hi ? 'हाँ, ऐसा हुआ था' : 'Yes, this happened',
    no: hi ? 'नहीं, ऐसा नहीं हुआ' : 'No, this did not happen',
    note: hi ? 'वैकल्पिक: असल में क्या हुआ था?' : 'Optional: what actually happened?',
    confirm: hi ? 'पुष्टि करें और समाप्त करें' : 'Confirm & finish',
    pending: hi ? `समाप्त करने के लिए सभी ${items.length} प्रश्नों के उत्तर दें` : `Answer all ${items.length} question(s) to finish`,
  }
  return (
    <div className="confirm-issues">
      <b>{t.title}</b>
      <p className="muted small">{t.intro}</p>
      <ol>
        {items.map((item) => (
          <li key={item.key}>
            <p>{hi ? item.questionHi : item.question}</p>
            <div className="yes-no" role="radiogroup" aria-label={hi ? item.questionHi : item.question}>
              <button type="button" role="radio" aria-checked={answers[item.key]?.answer === 'yes'} className={`btn small ${answers[item.key]?.answer === 'yes' ? 'primary' : ''}`} onClick={() => set(item.key, { answer: 'yes' })}>{t.yes}</button>
              <button type="button" role="radio" aria-checked={answers[item.key]?.answer === 'no'} className={`btn small ${answers[item.key]?.answer === 'no' ? 'danger-solid' : ''}`} onClick={() => set(item.key, { answer: 'no' })}>{t.no}</button>
            </div>
            {answers[item.key]?.answer === 'no' &&  <input placeholder={t.note} value={answers[item.key]?.note ?? ''} onChange={(e) => set(item.key, { note: e.target.value })} />}
          </li>
        ))}
      </ol>
      <button className="btn primary wide" disabled={!done} onClick={() => onConfirm(Object.fromEntries(items.map((item) => [item.key, { answer: answers[item.key]!.answer!, note: answers[item.key]?.note?.trim() || undefined }])))}>
        {done ? t.confirm : t.pending}
      </button>
    </div>
  )
}

function Submitted({ api }: { api: ExamApi }) {
  const { state } = api
  const candidate = api.mine!
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const entry = rosterEntry(candidate.candidateId)
  const submission = [...state.audit].reverse().find((item) => item.kind === 'submission' && item.candidateId === candidate.candidateId)
  const receipts = state.control.incidents.flatMap((incident) => (incident.decision?.receipts[candidate.candidateId] ? [incident.decision.receipts[candidate.candidateId]] : []))
  const rescheduled = candidate.submitReason === 'reschedule'
  const cancelled = candidate.submitReason === 'cancelled'
  const report = sessionReport(state, candidate.candidateId, Date.parse(candidate.submittedAt ?? new Date().toISOString()))
  return (
    <main className="doc-page">
      <header className="bar"><Brand inverse /><span className="row">{entry?.name} · {entry?.id}<button className="btn ghost small" onClick={api.logout}>Sign out</button></span></header>
      <section className="doc-card center">
        {rescheduled || cancelled ? <LockKeyhole size={40} className="warn-icon" /> : <BadgeCheck size={40} className="good-icon" />}
        <h1>{cancelled ? 'Your attempt was cancelled by the exam officer' : rescheduled ? 'Your attempt is paused for a targeted reschedule' : 'Your test has been submitted'}</h1>
        <p className="muted">{cancelled
          ? 'After reviewing repeated tab switching, the exam officer cancelled this attempt. Your saved answers are kept on record.'
          : rescheduled
          ? 'A verified interruption on your session exceeded the policy threshold. All answers up to the interruption are preserved; the exam body will share your new slot. This does not affect your eligibility.'
          : `Submitted at ${fmtTime(candidate.submittedAt)}${candidate.submitReason === 'time-up' ? ' (time-up auto-submit)' : ''}.`}</p>
        {submission?.data?.responseDigest && <p className="digest">Response digest <code>{String(submission.data.responseDigest)}</code></p>}
        <p>{String(submission?.data?.answered ?? 0)} of {BLUEPRINT.length} questions answered.</p>
        {submission?.data?.paperRoot && <p className="digest">Paper fingerprint <code>{String(submission.data.paperRoot).slice(0, 16)}</code> — the authority-signed paper you were shown</p>}
        {report.items.length > 0 && !candidate.acknowledgedAt
          ? <ConfirmIssues items={report.items} lang={candidate.lang} onConfirm={api.acknowledge} />
          : (
            <div className="session-report">
              <b>Session report</b>
              <ul>{report.items.length
                ? report.items.map((item) => <li key={item.key}>{item.line} <em className={candidate.acknowledgements?.[item.key]?.answer === 'no' ? 'disputed' : 'confirmed'}>{candidate.acknowledgements?.[item.key]?.answer === 'no' ? 'You disputed this' : 'You confirmed this'}</em></li>)
                : report.lines.map((line) => <li key={line}>{line}</li>)}</ul>
              <small>{api.syncConnected && api.serverReachable ? 'Sent to the exam office with your submission.' : 'Saved on this device; it reaches the exam office automatically when the connection returns.'}</small>
            </div>
          )}
        {receipts.map((item) => <button key={item.id} className="btn" onClick={() => setReceipt(item)}><ReceiptText size={15} /> Fairness Receipt {item.id}</button>)}
      </section>
      {receipt && <ReceiptModal receipt={receipt} state={state} onClose={() => setReceipt(null)} />}
    </main>
  )
}
