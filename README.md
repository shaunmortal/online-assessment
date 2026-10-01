<p align="center">
  <img src="./public/examshield-logo.webp" alt="ExamShield - Fair Exams. Trusted Results." width="440" />
</p>

<h1 align="center">ExamShield</h1>

<p align="center">
  <strong>Fair Exams. Trusted Results.</strong><br />
  <em>Prevention - Detection - Response - Recovery - Trust</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Hackathon-MPOnline%202026-1f6feb?style=for-the-badge" alt="MPOnline Hackathon 2026" />
  <img src="https://img.shields.io/badge/React-TypeScript-3178c6?style=for-the-badge" alt="React and TypeScript" />
  <img src="https://img.shields.io/badge/Approach-Offline--first-167c80?style=for-the-badge" alt="Offline-first" />
  <img src="https://img.shields.io/badge/Decisions-Human--approved-e3a008?style=for-the-badge" alt="Human-approved decisions" />
</p>

<p align="center">
  <a href="#the-idea">The idea</a> &bull;
  <a href="#product-views">Product views</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#run-locally">Run locally</a> &bull;
  <a href="#honest-boundaries">Boundaries</a>
</p>

> **ExamShield is an evidence-driven resilience layer for online examinations.** It prevents unsafe exam starts, detects session disruptions, preserves candidate work, recommends proportionate recovery, and generates verifiable evidence for fair, officer-approved decisions.

<p align="center">
  <img src="./public/readme/landing-hero.png" alt="ExamShield landing experience: The exam that never stops" width="100%" />
</p>

## The idea

An exam disruption should not automatically become a re-test for an entire hall - or an unprovable complaint for one candidate.

ExamShield is a browser exam platform built around one principle: **when a session is disrupted, keep the candidate answering offline, preserve every answer, measure what happened, and provide a fair, officer-approved, verifiable remedy.**

| What matters | How ExamShield responds |
| --- | --- |
| **A safe start** | A Readiness Gate checks the paper/version, language pack, timer drift, IndexedDB save channel, and exam-server heartbeat before the timer starts. |
| **Continuity** | Answers are checkpointed to IndexedDB first and reconciled with the server after recovery. |
| **Measured impact** | Heartbeats and a Control Tower identify individual and shared service disruptions. |
| **A proportionate decision** | The Remedy Engine recommends `Recover`, `Protect Time`, or `Targeted Reschedule`; high-stakes outcomes require officer approval. |
| **Trust after the incident** | A SHA-256 evidence chain and candidate-visible Fairness Receipt make the record verifiable. |

## Product views

<table>
  <tr>
    <td width="50%" valign="top"><strong>Candidate experience</strong><br /><sub>Sign in to a 27-question assessment with a clear, familiar exam flow.</sub><br /><br /><img src="./public/readme/candidate-login.png" alt="Candidate sign-in screen" /></td>
    <td width="50%" valign="top"><strong>Exam Control Tower</strong><br /><sub>Live session, heartbeat, checkpoint, signal, and incident visibility for exam officers.</sub><br /><br /><img src="./public/readme/control-tower.png" alt="Exam Control Tower live sessions screen" /></td>
  </tr>
</table>

<p align="center">
  <img src="./public/readme/landing-resilience.png" alt="ExamShield resilience flow and Fairness Receipt preview" width="100%" />
</p>

## Architecture

### From candidate session to verifiable receipt

```mermaid
flowchart LR
    C[Candidate browser] --> G[Readiness Gate]
    G --> E[Exam session]
    E --> CP[IndexedDB answer checkpoints]
    E --> H[Heartbeat and session signals]
    H --> T[Exam Control Tower]
    T --> I[Incident detection and classification]
    I --> R[Remedy Engine]
    R --> O[Officer approval]
    O --> F[Fairness Receipt]
    F --> V[QR / receipt verification]
    CP --> RC[Response reconciliation]
    RC --> F
    I --> EV[Evidence Vault]
    EV --> HC[SHA-256 hash chain]
    HC --> V
```

### The resilience lifecycle

```mermaid
flowchart LR
    P[Prevention<br/>Readiness Gate] --> D[Detection<br/>Heartbeat and watchdog]
    D --> S[Response<br/>Classify the incident]
    S --> R[Recovery<br/>Preserve and reconcile]
    R --> T[Trust<br/>Receipt and audit]
    T --> A[Learn<br/>Repeated failure signatures]
    A --> P
```

### Core components

| Component | Responsibility |
| --- | --- |
| **Candidate App** | Readiness, instructions, exam flow, answer checkpointing, recovery UX, and submission. |
| **Control Tower** | Live sessions, incidents, affected cohort visibility, officer workflow, and the Evidence Vault. |
| **IndexedDB** | Local-first answer preservation and queued saves while connectivity is unavailable. |
| **Heartbeat / Watchdog** | Session health signals and detection of silent or unavailable sessions. |
| **Incident Engine** | Individual-versus-shared outage classification and escalation context. |
| **Remedy Engine** | `Recover`, `Protect Time`, and `Targeted Reschedule` recommendations. |
| **Evidence Vault** | Event history, SHA-256 chain status, export, and tamper testing. |
| **Fairness Receipt** | Incident, measured impact, decision reason, officer, and verification data. |

## Candidate experience

ExamShield is designed to feel like an actual assessment, not a static dashboard.

| Step | Candidate experience | What is protected |
| --- | --- | --- |
| 1 | **Login** with Candidate ID and date of birth. | A candidate-specific exam session. |
| 2 | Review **Instructions**, sections, rules, language, and declaration. | Clear expectations before the paper begins. |
| 3 | Complete the **Readiness Gate** before the timer starts. | Paper integrity, save-channel availability, and session health. |
| 4 | Take the exam using the question palette, Save & Next, Mark for Review, and coding templates. | Every answer is checkpointed locally first. |
| 5 | Work with **BlurShield** and a rotating session/time watermark. | The focused area stays readable while the sensitive layer is protected. |
| 6 | Receive clear offline, recovery, and incident status. | The candidate can continue answering while queued saves await reconciliation. |
| 7 | Submit and receive a response digest and, when applicable, a **Fairness Receipt**. | A record the candidate can verify. |

### Integrity signals are never automatic penalties

The implementation can record fullscreen exits, tab/focus loss, copy/cut/paste/right-click/drag activity, camera loss or obstruction, and optional AI-proctor observations. These are **review-only signals** for an officer - not proof of misconduct, not automatic disqualification, and never an automatic mark change.

## Resilience and recovery

### Detect -> keep working -> preserve -> remedy -> receipt

```mermaid
sequenceDiagram
    participant C as Candidate browser
    participant L as IndexedDB
    participant T as Control Tower
    participant O as Exam officer
    participant V as Receipt verification

    C->>L: Checkpoint each answer locally
    C->>T: Send heartbeat and session signals
    Note over C: Connectivity is lost; the timer keeps running offline
    C->>L: Keep answers safe; queue sync work
    T->>T: Watchdog detects and classifies impact
    C->>T: Reconcile checkpoints after recovery
    T->>O: Recommend the smallest fair remedy
    O->>T: Approve high-stakes remedy
    T->>V: Issue Fairness Receipt with evidence-chain head
```

### Remedy Engine

| Situation | Recommendation | Decision rule |
| --- | --- | --- |
| Short individual interruption | `Recover` | Resume and reconcile the preserved work. |
| Longer or shared interruption | `Protect Time` | Use the measured interruption evidence to protect fairness. |
| Severe interruption, unreconciled answers, or insufficient remaining time | `Targeted Reschedule` | Re-schedule only affected candidate(s), not the whole cohort by default. |

**No marks are automatically changed.** High-stakes remedies require officer approval.

## Evidence and the Fairness Receipt

Every important event contributes to a SHA-256 hash chain. The candidate-facing Fairness Receipt makes the operational record inspectable instead of relying on a screenshot or a complaint alone.

| The receipt records | Why it matters |
| --- | --- |
| Incident ID and measured interruption interval | Establishes what happened and for how long. |
| Answers preserved and response reconciliation | Shows whether candidate work survived the interruption. |
| Remedy and decision reason | Makes the remedy reviewable and proportionate. |
| Officer approval | Keeps consequential decisions human-accountable. |
| Receipt hash and evidence-chain head | Provides a verifiable link to the recorded evidence. |
| QR verification link | Lets a recipient open the receipt-verification view. |

If a recorded event is edited, chain verification fails.

## Challenge alignment - 12 resilience points

The project follows the MPOnline challenge framing across the assessment lifecycle, while being explicit about MVP limits.

| # | Challenge point | ExamShield capability |
| ---: | --- | --- |
| 1 | Real-time monitoring | Candidate heartbeat, session state, and the Control Tower. |
| 2 | Early detection and prediction | Readiness Gate plus heartbeat/watchdog signals; this is early detection, not a claim of a full predictive model. |
| 3 | Incident detection, classification, and escalation | Individual/shared outage correlation and officer escalation. |
| 4 | Backup and disaster recovery | IndexedDB-first checkpoints, queued saves, and recovery across session interruption. |
| 5 | Tamper-evident storage | SHA-256 event hash chain, receipt hash, and tamper verification. |
| 6 | Suspicious-pattern detection | Review-only integrity signals and incident correlation. |
| 7 | Response reconciliation and validation | Queued answer reconciliation, sequence-aware checkpoints, and response digest. |
| 8 | Candidate communication | Offline status, incident banners, recovery state, and candidate receipt. |
| 9 | Reschedule / re-conduct decision support | `Recover` / `Protect Time` / `Targeted Reschedule` policy guidance. |
| 10 | Fairness and consistency | Measured interruption interval, targeted remedy, and officer approval. |
| 11 | Audit trail and evidence reporting | Evidence Vault, session reporting, export, and Fairness Receipt. |
| 12 | AI analytics for systemic risks and recurrence prevention | Repeated failure signatures feed preventive recommendations; not a completed predictive-analytics system. |

## Technology

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=0b1020" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=FFD62E" alt="Vite 5" />
  <img src="https://img.shields.io/badge/IndexedDB-Offline--first-00A98F?style=for-the-badge&logo=databricks&logoColor=white" alt="IndexedDB offline-first" />
  <img src="https://img.shields.io/badge/WebSocket-Live%20relay-0F172A?style=for-the-badge&logo=socketdotio&logoColor=white" alt="WebSocket live relay" />
  <img src="https://img.shields.io/badge/SHA--256-Evidence%20chain-EAB308?style=for-the-badge&logo=letsencrypt&logoColor=white" alt="SHA-256 evidence chain" />
  <img src="https://img.shields.io/badge/Three.js-Visual%20hero-111827?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/Claude-Review--only%20AI-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude review-only AI" />
</p>

<p align="center"><sub>A deliberate mix of resilient browser storage, real-time coordination, human-reviewed signals, and verifiable evidence.</sub></p>

| Layer | Stack / approach |
| --- | --- |
| Client | React, TypeScript, and Vite |
| Local resilience | IndexedDB, queued synchronization, and response reconciliation |
| Real-time coordination | HTTP heartbeat, watchdog, WebSocket relay, and Control Tower |
| Evidence | SHA-256 event chain, receipt verification, QR codes, and exportable evidence |
| Assessment | Multi-section paper, question palette, English/Hindi UI, JavaScript and Python coding tasks |
| Integrity | Browser signals, camera/mic and fullscreen checks, BlurShield, and watermarking |
| AI review | Optional Claude vision observations processed server-side; frames are not stored by the application |
| Visual experience | Three.js landing hero and a responsive candidate/operations interface |

## Run locally

### Prerequisites

- Node.js 20+
- A current desktop browser
- Optional: an Anthropic API key for the AI-proctoring demo

### Start the app

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use the following instead of `cp`:

```powershell
Copy-Item .env.example .env
```

| URL | Experience |
| --- | --- |
| `http://localhost:5190/` | Landing page and product story |
| `http://localhost:5190/exam` | Candidate assessment |
| `http://localhost:5190/ops` | Exam Control Tower |
| `http://localhost:5190/verify?r=<receipt>` | Fairness Receipt verification |

### Run an exam hall on a LAN

```bash
npm run dev:lan
```

This exposes the app at `https://<this-machine-ip>:5190` using a self-signed certificate. Each candidate PC needs HTTPS for camera access, so accept the certificate warning once on each machine. Every signed-in PC then appears in `/ops`.

### Demo credentials

| Candidate ID | Date of birth |
| --- | --- |
| `EXM-20841` | `14082004` |
| `EXM-20854` | `02112003` |
| `EXM-20873` | `17072004` |
| `EXM-20891` | `19092003` |

The full demo roster is defined in `src/data/paper.ts`.

## Demo checklist

<p align="center">
  <img src="https://img.shields.io/badge/01-Start%20the%20candidate%20exam-2563EB?style=flat-square" alt="Step 1: candidate exam" />
  <img src="https://img.shields.io/badge/02-Show%20the%20Readiness%20Gate-7C3AED?style=flat-square" alt="Step 2: Readiness Gate" />
  <img src="https://img.shields.io/badge/03-Open%20Control%20Tower-0891B2?style=flat-square" alt="Step 3: Control Tower" />
  <img src="https://img.shields.io/badge/04-Recover%20with%20evidence-16A34A?style=flat-square" alt="Step 4: recovery" />
  <img src="https://img.shields.io/badge/05-Verify%20the%20receipt-EAB308?style=flat-square" alt="Step 5: receipt verification" />
</p>

1. Open `/exam` and sign in with a demo candidate.
2. Walk through instructions and show the Readiness Gate before starting the paper.
3. Save a few answers, then open `/ops` in another tab to show the live session.
4. Use the Control Tower's simulation controls to demonstrate an interruption and recovery.
5. Verify that local checkpoints reconcile and inspect the incident/evidence record.
6. Show the officer-approved remedy and open the generated Fairness Receipt.
7. Scan or open the receipt verification link and run the tamper check.

## Development

```bash
npm test
npm run build
```

| Path | What it contains |
| --- | --- |
| `src/lib/core.ts` | Types, hash chain, receipt verification, multi-PC merge, Remedy Engine, and timer logic. |
| `src/state.ts` | Synchronization, IndexedDB, heartbeat, watchdog, and session actions. |
| `src/candidate.tsx` | Login, instructions, Readiness Gate, exam flow, and submit. |
| `src/ops.tsx` | Control Tower, incidents, remedies, and Evidence Vault. |
| `src/hooks/useIntegrity.ts` | Camera/mic, live-presence, fullscreen, obstruction checks, and AI-proctor loop. |
| `src/lib/runner.ts` | JavaScript and Python coding-task runners. |
| `server/proctor.ts` | Heartbeat and optional AI-proctor API. |
| `vite.config.ts` | Dev server, relay, and HTTPS LAN mode. |

## Contributors

<p align="center">
  <a href="https://github.com/shaunmortal">
    <img src="https://avatars.githubusercontent.com/u/218578165?v=4" width="104" height="104" alt="Ayush Kumar" style="border-radius: 50%; border: 4px solid #2563eb;" /><br />
    <sub><b>Ayush Kumar</b></sub>
  </a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://github.com/Cod4Nitish">
    <img src="https://avatars.githubusercontent.com/u/181256622?v=4" width="104" height="104" alt="Nitish Singh" style="border-radius: 50%; border: 4px solid #7c3aed;" /><br />
    <sub><b>Nitish Singh</b></sub>
  </a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://github.com/harsh-1-code">
    <img src="https://avatars.githubusercontent.com/u/218582164?v=4" width="104" height="104" alt="Harsh Kumar" style="border-radius: 50%; border: 4px solid #16a34a;" /><br />
    <sub><b>Harsh Kumar</b></sub>
  </a>
</p>

<p align="center">
  <a href="https://github.com/shaunmortal"><img src="https://img.shields.io/badge/Ayush%20Kumar-Contributor-2563EB?style=flat-square&logo=github&logoColor=white" alt="Ayush Kumar, contributor" /></a>
  <a href="https://github.com/Cod4Nitish"><img src="https://img.shields.io/badge/Nitish%20Singh-Contributor-7C3AED?style=flat-square&logo=github&logoColor=white" alt="Nitish Singh, contributor" /></a>
  <a href="https://github.com/harsh-1-code"><img src="https://img.shields.io/badge/Harsh%20Kumar-Contributor-16A34A?style=flat-square&logo=github&logoColor=white" alt="Harsh Kumar, contributor" /></a>
</p>

<p align="center">
  <a href="https://github.com/shaunmortal/online-assessment/graphs/contributors"><img src="https://img.shields.io/badge/Open%20source%20team-3%20contributors-F97316?style=for-the-badge&logo=github&logoColor=white" alt="Three contributors" /></a>
</p>

## Honest boundaries

- This is an MVP demonstrating **software-session resilience**, not a claim of complete physical-centre monitoring.
- It does not claim CCTV, biometric identity verification, physical-centre telemetry, power-grid monitoring, or guaranteed screenshot prevention.
- Browser-side integrity signals and AI observations are review-only; they should never be treated as proof of misconduct on their own.
- A production deployment needs hardened authentication and roles, a backend-owned durable session store, policy and accessibility review, and independently managed evidence/signing infrastructure.

---

<p align="center">
  <strong>When an online exam fails, make the failure measurable, the recovery fair, and the evidence trustworthy.</strong>
</p>
