import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, ArrowRight, Camera, EyeOff, ScanFace } from 'lucide-react'
import Hero3D from './Hero3D'

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a className={`lp-brand ${inverse ? 'inverse' : ''}`} href="/landing.html" aria-label="ExamShield AI home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="7" />
        <path d="M10 9h12M10 16h9M10 23h12M10 9v14" />
      </svg>
      <span>ExamShield<small>AI</small></span>
    </a>
  )
}

function Section({ id, n, dark, eyebrow, title, lede, children, className = '' }: { id?: string; n: string; dark?: boolean; eyebrow: string; title: ReactNode; lede?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`lp-section ${dark ? 'dark' : ''} ${className}`}>
      <div className="lp-wrap">
        <header className="lp-section-head lp-reveal">
          <p className="lp-eyebrow"><span className="lp-idx">{n}</span>{eyebrow}</p>
          <h2>{title}</h2>
          {lede && <p className="lp-lede">{lede}</p>}
        </header>
        <div className="lp-reveal">{children}</div>
      </div>
    </section>
  )
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.lp-reveal')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

/* ---------- Fairness receipt: a real SHA-256 chain, hashed in the browser ---------- */
const EVENTS = [
  'READY  paper=27q  channel=ok  heartbeat=ok',
  'ANSWER q07 → C',
  'OFFLINE 00:00:42  timer=running  saved=device',
  'SYNC  27/27 answers  0 lost',
  'SUBMIT  remedy=none  officer=verified',
]
type Block = { payload: string; prev: string; hash: string }
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

function Receipt() {
  const [chain, setChain] = useState<Block[]>([])
  const [tampered, setTampered] = useState(false)
  const [bad, setBad] = useState<boolean[]>([])
  const supported = typeof crypto !== 'undefined' && !!crypto.subtle

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    ;(async () => {
      const out: Block[] = []
      let prev = 'genesis'
      for (const payload of EVENTS) {
        const hash = await sha(prev + '|' + payload)
        out.push({ payload, prev, hash })
        prev = hash
      }
      if (!cancelled) setChain(out)
    })()
    return () => { cancelled = true }
  }, [supported])

  useEffect(() => {
    if (!chain.length) return
    let cancelled = false
    ;(async () => {
      const shown = chain.map((b, i) => (tampered && i === 1 ? { ...b, payload: 'ANSWER q07 → A' } : b))
      const result: boolean[] = []
      for (let i = 0; i < shown.length; i++) {
        const ok = (await sha(shown[i].prev + '|' + shown[i].payload)) === shown[i].hash && (i === 0 || shown[i].prev === shown[i - 1].hash)
        result.push(!ok || (i > 0 && result[i - 1]))
      }
      if (!cancelled) setBad(result)
    })()
    return () => { cancelled = true }
  }, [chain, tampered])

  const failed = bad.some(Boolean)
  return (
    <div className={`lp-receipt ${failed ? 'failed' : ''}`}>
      <div className="lp-receipt-top">
        <div>
          <p className="lp-eyebrow">Fairness receipt</p>
          <strong>{supported ? (failed ? 'Verification failed at event 2' : 'Chain verified · 5 of 5 events') : 'Chain preview'}</strong>
          <small>{supported ? 'These hashes are computed live by your browser with SubtleCrypto.' : 'Live hashing needs a secure context (https or localhost).'}</small>
        </div>
        <button type="button" className="lp-btn small" onClick={() => setTampered((v) => !v)} disabled={!supported}>
          {tampered ? 'Restore the record' : 'Tamper with an answer'}
        </button>
      </div>
      <ol className="lp-chain">
        {(chain.length ? chain : EVENTS.map((payload) => ({ payload, prev: '', hash: '' }))).map((b, i) => (
          <li key={i} className={bad[i] ? 'bad' : ''}>
            <span className="lp-chain-n">{String(i + 1).padStart(2, '0')}</span>
            <code className="lp-chain-payload">{tampered && i === 1 ? 'ANSWER q07 → A' : b.payload}</code>
            <code className="lp-chain-hash">{b.hash ? b.hash.slice(0, 20) + '…' : '—'}</code>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---------- Control Tower mock (HTML, illustrative) ---------- */
const PCS = [
  ['PC-01', 'C-2031', '2s', '00:00', 19, ''],
  ['PC-02', 'C-2032', '1s', '00:00', 21, ''],
  ['PC-03', 'C-2033', '3s', '00:00', 17, 'Tab switch · warning'],
  ['PC-04', 'C-2034', '2s', '00:00', 22, ''],
  ['PC-05', 'C-2035', '41s', '00:41', 14, 'Shared outage · Row B'],
  ['PC-06', 'C-2036', '39s', '00:39', 15, 'Shared outage · Row B'],
  ['PC-07', 'C-2037', '2s', '00:00', 20, ''],
  ['PC-08', 'C-2038', '1s', '00:12', 23, 'Recovered · time protected'],
] as const

function Tower() {
  return (
    <div className="lp-tower" aria-label="Illustration of the Control Tower screen">
      <div className="lp-tower-bar">
        <span className="lp-tower-title">Control Tower</span>
        <span className="lp-mono">HALL 3 · 08 sessions · relay connected</span>
      </div>
      <div className="lp-tower-body">
        <table>
          <thead>
            <tr><th>PC</th><th>Candidate</th><th>Heartbeat</th><th>Offline</th><th>Progress</th><th>Alerts</th></tr>
          </thead>
          <tbody>
            {PCS.map(([pc, cand, hb, off, done, alert]) => {
              const tone = off !== '00:00' && !alert.startsWith('Recovered') ? 'bad' : alert ? 'warn' : 'good'
              return (
                <tr key={pc}>
                  <td className="lp-mono">{pc}</td>
                  <td className="lp-mono">{cand}</td>
                  <td><span className={`lp-dot ${tone}`} />{hb}</td>
                  <td className="lp-mono">{off}</td>
                  <td><span className="lp-prog"><i style={{ width: `${(done / 27) * 100}%` }} /></span><small>{done}/27</small></td>
                  <td className={`lp-alert ${tone}`}>{alert || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <aside>
          <p className="lp-eyebrow">Pending remedy</p>
          <div className="lp-remedy">
            <strong>Row B · 2 candidates · shared outage 00:41</strong>
            <span>Proposed: protect time (+00:41). Requires officer approval.</span>
            <div className="lp-remedy-actions"><span className="lp-chip">Approve</span><span className="lp-chip ghost">Targeted re-exam</span></div>
          </div>
          <p className="lp-eyebrow">Evidence vault</p>
          <ul className="lp-vault">
            <li><span>C-2035 · OFFLINE</span><code>8f1c…a2d9</code></li>
            <li><span>C-2036 · OFFLINE</span><code>5b70…e14c</code></li>
            <li><span>C-2033 · TAB_SWITCH</span><code>c3e9…7b02</code></li>
            <li><span>C-2038 · SYNC 23/27</span><code>19aa…40f6</code></li>
          </ul>
        </aside>
      </div>
    </div>
  )
}

const STEPS = [
  { t: 'Readiness gate', d: 'Before the timer starts, the machine proves it can carry the exam: the paper hash matches, the save channel answers, the heartbeat is alive.', m: 'paper.sha256 · save-channel · heartbeat' },
  { t: 'Offline-first exam', d: 'The timer keeps running on the device. Every answer is saved locally the moment it is chosen and syncs the instant a link returns.', m: 'timer=local · answers=device · auto-sync' },
  { t: 'Detect & correlate', d: 'A heartbeat watchdog notices silence within seconds and tells the difference between one PC dropping out and a whole row going dark.', m: 'watchdog · individual vs shared outage' },
  { t: 'Fair remedy', d: 'Recover the session, protect the lost time, or schedule a targeted re-exam for that candidate only. An exam officer approves every remedy; nothing is automatic.', m: 'recover · protect time · targeted re-exam' },
  { t: 'Fairness receipt', d: 'Every event is hashed into a SHA-256 chain the candidate takes home as a QR code. Change one record and verification fails.', m: 'QR · SHA-256 chain · tamper ⇒ fail' },
]

const PALETTE = Array.from({ length: 27 }, (_, i) => (i < 14 ? 'done' : i === 14 ? 'now' : [16, 19].includes(i) ? 'marked' : ''))

export default function Landing() {
  useReveal()
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-hero">
        <Hero3D />
        <nav className="lp-nav" aria-label="Primary">
          <div className="lp-wrap">
            <Brand inverse />
            <div className="lp-nav-links">
              <a href="#how">How it works</a>
              <a href="#integrity">Integrity</a>
              <a href="#tower">Control Tower</a>
              <a href="#boundaries">Boundaries</a>
            </div>
            <a className="lp-btn gold small" href="/ops">Open Control Tower</a>
          </div>
        </nav>
        <div className="lp-wrap lp-hero-content">
          <p className="lp-eyebrow">Resilient &amp; trustworthy online assessment</p>
          <h1>The exam that never stops.</h1>
          <p className="lp-hero-sub">
            When the network drops or the power blinks, ExamShield keeps the clock honest, keeps every answer, and gives the affected candidate a fair, officer-approved remedy instead of a re-test for the whole hall.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn gold" href="/exam">Take the demo exam <ArrowRight size={16} aria-hidden="true" /></a>
            <a className="lp-btn outline" href="/ops">Open Control Tower</a>
          </div>
          <p className="lp-mono lp-hero-line">SHA-256 evidence chain · offline-first · officer-approved remedies</p>
        </div>
        <div className="lp-hero-strip">
          <div className="lp-wrap">
            <span><b>Timer</b> keeps running offline</span>
            <span><b>Answers</b> saved on the device first</span>
            <span><b>Remedies</b> scoped to the affected candidate</span>
            <span><b>Receipt</b> the candidate can verify</span>
          </div>
        </div>
      </header>

      <main id="main">
        <Section n="01" eyebrow="The problem" title={<>One frozen screen. <em>One re-exam for everyone.</em></>} lede="Large online exams in India have been paused, extended and re-conducted after technical snags. The damage is not only the outage itself — it is what happens after.">
          <div className="lp-cols3">
            <article>
              <span className="lp-num">01</span>
              <h3>Lost time is lost silently</h3>
              <p>A candidate whose PC reboots usually returns to a timer that kept counting against them, with no record of how long they were out.</p>
            </article>
            <article>
              <span className="lp-num">02</span>
              <h3>Whole cohorts pay for one row</h3>
              <p>Without a way to tell which sessions were actually affected, the safe administrative answer is to re-conduct the entire sitting.</p>
            </article>
            <article>
              <span className="lp-num">03</span>
              <h3>No proof for the candidate</h3>
              <p>Disputes come down to a screenshot and a complaint form. The candidate cannot demonstrate what happened, and neither can the centre.</p>
            </article>
          </div>
        </Section>

        <Section id="how" n="02" dark eyebrow="How it works" title="Five steps between a disruption and a fair result." lede="The whole flow is built into the exam client and the officer console you can open from this page.">
          <div className="lp-how">
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <span className="lp-step-n">{i + 1}</span>
                <div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                  <code className="lp-mono">{s.m}</code>
                </div>
              </li>
            ))}
          </ol>
          <Receipt />
          </div>
        </Section>

        <Section id="integrity" n="03" eyebrow="Integrity without injustice" title={<>Strict on cheating. <em>Careful with people.</em></>} lede="Every signal is a signal for a human officer, never a verdict. No candidate is auto-cancelled by a rule or a model.">
          <div className="lp-grid2">
            <article className="lp-card">
              <EyeOff size={20} aria-hidden="true" />
              <h3>BlurShield</h3>
              <p>Only the area the candidate is focused on is readable; the rest of the paper stays blurred and every screen carries a candidate-specific watermark.</p>
            </article>
            <article className="lp-card">
              <Camera size={20} aria-hidden="true" />
              <h3>Camera, mic and fullscreen</h3>
              <p>A liveness check before the paper opens, then a continuous camera and microphone stream inside a fullscreen session that notices when it is left.</p>
            </article>
            <article className="lp-card">
              <ScanFace size={20} aria-hidden="true" />
              <h3>AI proctor with Claude vision</h3>
              <p>Periodic frames are reviewed for multiple faces, devices and obstruction. Observations are logged for review and attached to the evidence trail — nothing more.</p>
            </article>
            <article className="lp-card">
              <AppWindow size={20} aria-hidden="true" />
              <h3>Graduated tab-switch policy</h3>
              <p>First time, a warning. Repeated, a ten-minute lock with the timer paused. After that, an officer decides with the full record in front of them.</p>
              <ol className="lp-ladder"><li>Warning</li><li>10-min lock</li><li>Officer decides</li></ol>
            </article>
          </div>
        </Section>

        <Section id="tower" n="04" dark eyebrow="Control Tower" title="Every seat in the hall, live." lede="Heartbeat, offline time, progress and alerts for every PC, with the evidence vault one click away. Officers see the shared outage as a row, not as eight separate complaints.">
          <Tower />
          <p className="lp-caption lp-mono">Illustrative view. The live console is at /ops.</p>
        </Section>

        <Section n="05" eyebrow="A real exam, not a toy" title="A full paper the way candidates actually sit one." lede="The demo is a 27-question paper with sections, a question palette, Hindi and English, and coding questions with runnable templates.">
          <div className="lp-exam">
            <div className="lp-exam-card">
              <p className="lp-eyebrow">Question palette</p>
              <div className="lp-palette" aria-hidden="true">
                {PALETTE.map((s, i) => <span key={i} className={s}>{i + 1}</span>)}
              </div>
              <ul className="lp-legend">
                <li><i className="done" />Answered</li>
                <li><i className="now" />Current</li>
                <li><i className="marked" />Marked for review</li>
              </ul>
            </div>
            <div className="lp-exam-card code">
              <p className="lp-eyebrow">Coding · Python template</p>
              <pre className="lp-mono">{[
                <><span className="k">def</span> solve(nums):</>,
                <>    <span className="c"># return the length of the longest</span></>,
                <>    <span className="c"># strictly increasing subsequence</span></>,
                <>    best = []</>,
                <>    <span className="k">for</span> n <span className="k">in</span> nums:</>,
                <>        ...</>,
                <>    <span className="k">return</span> len(best)</>,
              ].map((line, i) => <span key={i} className="ln"><span className="no">{i + 1}</span>{line}{'\n'}</span>)}</pre>
              <ul className="lp-legend"><li>JavaScript &amp; Python</li><li>Sections A–C</li><li>हिन्दी / English</li></ul>
            </div>
          </div>
        </Section>

        <Section id="boundaries" n="06" eyebrow="Honest boundaries" title="What this build does not claim." className="tight">
          <ul className="lp-bounds">
            <li><strong>A browser cannot block OS screenshots.</strong> BlurShield and watermarks make a capture far less useful; they do not make it impossible.</li>
            <li><strong>AI observations are review-only.</strong> Claude vision flags moments for a human. It never scores a candidate or cancels a session.</li>
            <li><strong>Production needs a backend.</strong> The demo runs on a local relay; a real deployment needs authentication, a server-side vault and signed receipts.</li>
          </ul>
        </Section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-final">
          <div>
            <p className="lp-eyebrow">See it run</p>
            <h2>Sit the paper. Pull the network cable. Watch it recover.</h2>
          </div>
          <div className="lp-cta-row">
            <a className="lp-btn gold" href="/exam">Take the demo exam <ArrowRight size={16} aria-hidden="true" /></a>
            <a className="lp-btn outline" href="/ops">Open Control Tower</a>
          </div>
        </div>
        <div className="lp-wrap lp-foot-row">
          <Brand inverse />
          <span className="lp-mono">Built for the Resilient &amp; Trustworthy Online Assessment Ecosystem hackathon</span>
        </div>
      </footer>
    </div>
  )
}
