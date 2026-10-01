import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Download, ShieldCheck, ShieldX, X } from 'lucide-react'
import { verifyReceipt, type ExamState, type Receipt, type ReceiptCheck } from './lib/core'
import { serverKey } from './lib/paperClient'

// ---- officer passcode (only enforced when the server has OFFICER_PASSCODE set)
const OFFICER_KEY = 'examshield:officer'
export const officerPasscode = () => window.sessionStorage.getItem(OFFICER_KEY) ?? undefined
export const officerHeaders = (): Record<string, string> => (officerPasscode() ? { 'x-officer-passcode': officerPasscode()! } : {})

export function OfficerGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'open' | 'locked'>('checking')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void (async () => {
      try {
        const { officerRequired } = await (await fetch('/api/auth-status')).json()
        if (!officerRequired) return setStatus('open')
        const saved = officerPasscode()
        const ok = saved && (await fetch('/api/officer-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: saved }) })).ok
        setStatus(ok ? 'open' : 'locked')
      } catch {
        setStatus('open') // server unreachable: show the cached view; the relay still enforces access
      }
    })()
  }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = (await fetch('/api/officer-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: code }) })).ok
    if (!ok) return setError('Wrong passcode.')
    window.sessionStorage.setItem(OFFICER_KEY, code)
    window.location.reload() // reconnect the relay as an officer
  }
  if (status === 'checking') return null
  if (status === 'open') return <>{children}</>
  return (
    <main className="verify-page">
      <header className="bar"><Brand inverse /><span>Exam officers only</span></header>
      <section className="card">
        <h1>Control Tower sign-in</h1>
        <p className="muted">Enter the officer passcode for this exam session.</p>
        <form onSubmit={(event) => void submit(event)} className="row wrap">
          <input type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Officer passcode" aria-label="Officer passcode" />
          <button className="btn primary" type="submit">Open Control Tower</button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  )
}

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`brand ${inverse ? 'inverse' : ''}`}>
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="7" />
        <path d="M10 9h12M10 16h9M10 23h12M10 9v14" />
      </svg>
      <span className="brand-word">ExamShield</span>
    </span>
  )
}

export function Pill({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

export const fmtClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':')
}

export const fmtTime = (value?: string) =>
  value ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '—'

export const policyLabel = { recover: 'Recover', 'protect-time': 'Protect time', reschedule: 'Targeted reschedule' } as const

export function useNow(intervalMs = 1000) {
  const [value, setValue] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setValue(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return value
}

export function BinaryTree() {
  return (
    <figure className="reference">
      <figcaption>Reference — binary tree (not blurred)</figcaption>
      <svg viewBox="0 0 340 220" role="img" aria-label="Binary tree: root 5, left child 2 with right child 4, right child 8 with left child 7">
        <path d="M170 55 L93 121 M170 55 L247 121 M93 140 L132 190 M247 140 L208 190" />
        {[[170, 42, 5], [93, 126, 2], [247, 126, 8], [132, 195, 4], [208, 195, 7]].map(([x, y, n]) => (
          <g key={n}><circle cx={x} cy={y} r="22" /><text x={x} y={y + 6}>{n}</text></g>
        ))}
      </svg>
    </figure>
  )
}


export type SignatureStatus = 'valid' | 'invalid' | 'unsigned' | 'unavailable'

// ECDSA P-256 check of the exam server's signature over the receipt hash, done in this browser.
export async function verifySignature(receipt: Receipt): Promise<SignatureStatus> {
  if (!receipt.serverSignature) return 'unsigned'
  const server = await serverKey()
  if (!server) return 'unavailable'
  if (receipt.keyId !== server.keyId) return 'invalid'
  const signature = Uint8Array.from(atob(receipt.serverSignature), (char) => char.charCodeAt(0))
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, server.key, signature, new TextEncoder().encode(receipt.hash))
  return ok ? 'valid' : 'invalid'
}

export function useReceiptCheck(receipt: Receipt | undefined, state: ExamState) {
  const [check, setCheck] = useState<(ReceiptCheck & { signature: SignatureStatus }) | null>(null)
  useEffect(() => {
    if (!receipt) return
    let alive = true
    const local = async (): Promise<ReceiptCheck> => {
      const result = await verifyReceipt(receipt, state.sessionId, state.audit)
      // A candidate PC only holds its own part of the log: let the exam server check the full chain.
      if (result.ok || !result.problem?.includes('missing from the evidence store')) return result
      try {
        const response = await fetch('/api/verify-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receipt }) })
        if (response.ok) return (await response.json()) as ReceiptCheck
      } catch {
        // offline: keep the local result
      }
      return result
    }
    void Promise.all([local(), verifySignature(receipt)]).then(([result, signature]) => {
      if (alive) setCheck({ ...result, ok: result.ok && signature !== 'invalid', signature })
    })
    return () => { alive = false }
  }, [receipt, state.sessionId, state.audit])
  return check
}

export function SignatureLine({ check, receipt }: { check: { signature: SignatureStatus } | null; receipt: Receipt }) {
  if (!check) return null
  if (check.signature === 'valid') return <Pill tone="good">Signed by the exam server · key {receipt.keyId}</Pill>
  if (check.signature === 'invalid') return <Pill tone="bad">Server signature INVALID</Pill>
  if (check.signature === 'unavailable') return <Pill tone="warn">Server key unreachable — signature not checked</Pill>
  return <Pill tone="warn">Not yet signed by the exam server</Pill>
}

export function VerifyBadge({ check }: { check: ReceiptCheck | null }) {
  if (!check) return <Pill tone="info">Verifying…</Pill>
  return check.ok
    ? <Pill tone="good"><CheckCircle2 size={13} /> Evidence chain verified</Pill>
    : <Pill tone="bad"><ShieldX size={13} /> Verification failed</Pill>
}

export function ReceiptModal({ receipt, state, onClose }: { receipt: Receipt; state: ExamState; onClose: () => void }) {
  const check = useReceiptCheck(receipt, state)
  const [qr, setQr] = useState('')
  const verifyUrl = `${window.location.origin}/verify?r=${encodeURIComponent(receipt.id)}&h=${receipt.hash.slice(0, 16)}`

  useEffect(() => {
    void QRCode.toDataURL(verifyUrl, { margin: 1, width: 168, errorCorrectionLevel: 'M' }).then(setQr)
  }, [verifyUrl])

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${receipt.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal receipt" role="dialog" aria-modal="true" aria-labelledby="receipt-title" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <header>
          <small>Candidate Fairness Receipt · {receipt.id}</small>
          <h2 id="receipt-title">Your interruption and recovery, on record</h2>
          <VerifyBadge check={check} />
          <SignatureLine check={check} receipt={receipt} />
          {check && !check.ok && <p className="error-text">{check.problem ?? 'The server signature does not match this receipt.'}</p>}
        </header>
        <dl className="receipt-grid">
          <div><dt>Candidate</dt><dd>{receipt.candidateName}<small>{receipt.candidateId}</small></dd></div>
          <div><dt>Incident</dt><dd>{receipt.incidentId}</dd></div>
          <div><dt>Affected interval</dt><dd>{fmtTime(receipt.interval.from)} → {fmtTime(receipt.interval.to)}<small>{receipt.interval.seconds}s measured</small></dd></div>
          <div><dt>Answers preserved</dt><dd>{receipt.answersPreserved}<small>{receipt.checkpointsPreserved} checkpoints</small></dd></div>
          <div><dt>Remedy</dt><dd>{policyLabel[receipt.policy]}<small>{receipt.policy === 'reschedule' ? 'Re-exam in a new slot' : receipt.creditSeconds ? `+${receipt.creditSeconds}s added to your timer` : 'Kept answering offline — no time lost'}</small></dd></div>
          <div><dt>Decided by</dt><dd>{receipt.officer}<small>{fmtTime(receipt.decidedAt)}</small></dd></div>
        </dl>
        <p className="reason"><b>Decision reason:</b> {receipt.reason}</p>
        <div className="proof">
          {qr ? <img src={qr} alt="QR code linking to the receipt verification page" width={140} height={140} /> : <span className="qr-placeholder" />}
          <div>
            <small>Receipt hash (SHA-256)</small>
            <code>{receipt.hash}</code>
            <small>Evidence chain head over {receipt.eventIds.length} events</small>
            <code>{receipt.auditHead}</code>
          </div>
        </div>
        <footer>
          <a className="btn ghost" href={verifyUrl} target="_blank" rel="noreferrer">Open verification page</a>
          <button className="btn primary" onClick={download}><Download size={15} /> Download receipt (.json)</button>
        </footer>
      </section>
    </div>
  )
}

export function VerifyPage({ state }: { state: ExamState }) {
  const params = new URLSearchParams(window.location.search)
  const receipts = [...state.control.incidents.flatMap((incident) => Object.values(incident.decision?.receipts ?? {})), ...Object.values(state.control.reexams ?? {}).flatMap((item) => (item.receipt ? [item.receipt] : []))]
  const [uploaded, setUploaded] = useState<Receipt | undefined>()
  const [uploadError, setUploadError] = useState('')
  const receipt = uploaded ?? receipts.find((item) => item.id === params.get('r'))
  const check = useReceiptCheck(receipt, state)
  const hashPrefix = params.get('h')
  const qrMatches = !hashPrefix || !receipt || receipt.hash.startsWith(hashPrefix)

  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Receipt
      if (!parsed.id || !parsed.hash || !Array.isArray(parsed.eventIds)) throw new Error('Not an ExamShield receipt')
      setUploaded(parsed)
      setUploadError('')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not read the file')
    }
  }

  return (
    <main className="verify-page">
      <header className="bar"><Brand inverse /><a href="/ops">Control Tower</a></header>
      <section className="card">
        <h1>Verify a Fairness Receipt</h1>
        <p className="muted">Recomputes the receipt hash, every sealed event digest and the evidence-chain head from this browser's evidence store.</p>
        <label className="file-input">Verify a downloaded receipt file <input type="file" accept="application/json" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        {uploadError && <p className="error-text">{uploadError}</p>}
        {!receipt && <p className="muted">No receipt found for <code>{params.get('r') ?? '(none)'}</code> in this evidence store. Open this page on the exam network or upload the receipt file.</p>}
        {receipt && (
          <>
            <h2>{receipt.id}</h2>
            <VerifyBadge check={check} />
            {!qrMatches && <p className="error-text">The QR hash prefix does not match this receipt.</p>}
            <ul className="checklist">
              <li className={check?.receiptIntact ? 'ok' : 'bad'}>Receipt fields match their sealed hash</li>
              <li className={check?.eventsIntact ? 'ok' : 'bad'}>All {receipt.eventIds.length} evidence events match their digests</li>
              <li className={check?.chainIntact ? 'ok' : 'bad'}>Evidence-chain head matches the receipt</li>
              <li className={check?.signature === 'valid' ? 'ok' : 'bad'}>{check?.signature === 'valid' ? `Signature by the exam server (key ${receipt.keyId}) is valid` : check?.signature === 'unsigned' ? 'Receipt has not been signed by the exam server' : 'Exam-server signature could not be verified'}</li>
            </ul>
            {check?.problem && <p className="error-text">{check.problem}</p>}
          </>
        )}
      </section>
    </main>
  )
}
