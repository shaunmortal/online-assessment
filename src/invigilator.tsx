import { useState } from 'react'
import { BadgeCheck, Hand, MonitorX, Repeat2, Wifi, WifiOff } from 'lucide-react'
import { lockState, type CandidateSlice, type ExamState } from './lib/core'
import { ROSTER, seatLabel, type RosterEntry } from './data/paper'
import { heartbeatAge, type ExamApi } from './state'
import { Brand, fmtTime, Pill, useNow } from './ui'

// The room-level view: what the invigilator walking the lab needs, seat by seat.
const CENTRES = [...new Set(ROSTER.map((entry) => entry.centre))]
const NAME_KEY = 'examshield:invigilator'
type ReportKind = 'pc-failure' | 'power-cut' | 'malpractice' | 'other'

function seatStatus(state: ExamState, slice: CandidateSlice | undefined, nowMs: number): { label: string; tone: 'neutral' | 'info' | 'good' | 'warn' | 'bad' } {
  if (!slice || slice.phase === 'login') return { label: 'Not signed in', tone: 'neutral' }
  if (slice.phase === 'submitted') return { label: 'Submitted', tone: 'good' }
  const lock = lockState(state, slice.candidateId, nowMs)
  if (lock === 'suspended') return { label: 'Suspended — officer', tone: 'bad' }
  if (lock === 'locked') return { label: 'Locked (tab switch)', tone: 'warn' }
  const silent = heartbeatAge(slice, nowMs) > 8 || slice.outages.some((o) => !o.to)
  if (slice.phase === 'exam') return silent ? { label: 'PC silent / offline', tone: 'bad' } : { label: 'Writing', tone: 'info' }
  return { label: slice.phase === 'gate' ? 'System check' : 'Reading instructions', tone: silent ? 'warn' : 'neutral' }
}

function Seat({ entry, api, by, nowMs }: { entry: RosterEntry; api: ExamApi; by: string; nowMs: number }) {
  const { state } = api
  const slice = state.candidates[entry.id]
  const status = seatStatus(state, slice, nowMs)
  const verified = state.control.verified?.[entry.id]
  const moved = state.control.seatMoves?.[entry.id]
  const [kind, setKind] = useState<ReportKind | ''>('')
  const [note, setNote] = useState('')
  const signedIn = Boolean(slice && slice.phase !== 'login')
  return (
    <article className={`seat ${status.tone}`} aria-label={`${seatLabel(entry)} ${entry.name}`}>
      <header><b>{seatLabel(entry).replace(/^Lab \w · /, '')}</b><Pill tone={status.tone}>{status.tone === 'bad' ? <WifiOff size={11} /> : <Wifi size={11} />} {status.label}</Pill></header>
      <p><b>{entry.name}</b><small>{entry.id} · DOB {entry.dob.replace(/(\d\d)(\d\d)(\d{4})/, '$1/$2/$3')}</small></p>
      {verified
        ? <Pill tone="good"><BadgeCheck size={12} /> ID verified {fmtTime(verified.at)}</Pill>
        : <button className="btn small primary" disabled={!signedIn} onClick={() => api.verifyIdentity(entry.id, by)} title={signedIn ? 'Admit card and photo ID checked at the seat' : 'Candidate has not signed in yet'}><BadgeCheck size={13} /> Verify ID</button>}
      <div className="row wrap">
        <button className="btn small" disabled={!signedIn || slice?.phase === 'submitted'} onClick={() => api.approveSeatMove(entry.id, by, 'Invigilator moved the candidate to a spare PC.')}><Repeat2 size={13} /> {moved ? `Spare PC ok ${fmtTime(moved)}` : 'Spare PC'}</button>
        <select aria-label="Report a problem at this seat" value={kind} onChange={(e) => setKind(e.target.value as ReportKind | '')}>
          <option value="">Report…</option>
          <option value="pc-failure">PC failure / hang</option>
          <option value="power-cut">Power cut</option>
          <option value="malpractice">Suspected malpractice</option>
          <option value="other">Other</option>
        </select>
      </div>
      {kind && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); api.invigilatorReport(entry.id, by, kind, note.trim()); setKind(''); setNote('') }}>
          <input aria-label="What you saw" placeholder="What you saw (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn small danger-solid" type="submit"><Hand size={13} /> Send</button>
        </form>
      )}
    </article>
  )
}

export function InvigilatorApp({ api }: { api: ExamApi }) {
  const nowMs = useNow(1000)
  const [centre, setCentre] = useState(CENTRES[0])
  const [by, setBy] = useState(() => { try { return window.localStorage.getItem(NAME_KEY) || 'Invigilator' } catch { return 'Invigilator' } })
  const name = by.trim() || 'Invigilator'
  const seats = ROSTER.filter((entry) => entry.centre === centre)
  const labs = [...new Set(seats.map((entry) => entry.lab))]
  const ids = new Set(seats.map((entry) => entry.id))
  const recent = api.state.audit.filter((item) => item.candidateId && ids.has(item.candidateId) && item.kind !== 'heartbeat' && item.kind !== 'checkpoint').slice(-10).reverse()
  const verified = seats.filter((entry) => api.state.control.verified?.[entry.id]).length
  return (
    <main className="doc-page invigilator">
      <header className="bar"><Brand inverse /><span>Invigilator console</span></header>
      <section className="doc-card wide">
        <div className="card-head">
          <h1>{centre} · seat map</h1>
          <div className="row wrap">
            <label className="toggle">Centre <select value={centre} onChange={(e) => setCentre(e.target.value)}>{CENTRES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="toggle">Signed as <input value={by} onChange={(e) => { setBy(e.target.value); try { window.localStorage.setItem(NAME_KEY, e.target.value) } catch { /* private mode */ } }} /></label>
          </div>
        </div>
        <p className="muted small">
          {api.state.control.centreMode ? 'Centre mode is ON: a candidate cannot start until you verify their ID here.' : 'Centre mode is OFF (remote-proctored); ID verification is recorded but not required.'}
          {' '}{verified}/{seats.length} verified. Everything you record is time-stamped in the evidence chain and shown to the exam officer.
        </p>
        {labs.map((lab) => {
          const inLab = seats.filter((entry) => entry.lab === lab)
          const cols = Math.max(...inLab.map((entry) => entry.col))
          return (
            <div key={lab} className="lab">
              <h2>Lab {lab} <small>front of room ↑</small></h2>
              <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {inLab.map((entry) => <div key={entry.id} style={{ gridRow: entry.row, gridColumn: entry.col }}><Seat entry={entry} api={api} by={name} nowMs={nowMs} /></div>)}
              </div>
            </div>
          )
        })}
      </section>
      <section className="doc-card wide">
        <h2><MonitorX size={16} /> Latest at this centre</h2>
        {recent.length ? <ul className="evidence">{recent.map((item) => <li key={item.id}><small>{fmtTime(item.at)}</small> <b>{item.title}</b> <small>{item.source}</small></li>)}</ul> : <p className="muted small">Nothing yet.</p>}
      </section>
    </main>
  )
}
