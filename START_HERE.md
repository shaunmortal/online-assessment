# ExamShield — Start Here

This is a hackathon MVP for **Resilient & Trustworthy Online Assessment Ecosystem**. The product is called **ExamShield**.

The core pitch is not only “AI proctoring.” It is an evidence-led exam platform that protects the candidate during a disruption:

> **Prevention → Detection → Response → Recovery → Trust**

It combines a real browser integrity layer with answer checkpointing, disruption recovery, officer approval, and a candidate-visible Fairness Receipt.

## Non-negotiable product rules

- The UI must feel like a real online examination, not a static hackathon dashboard.
- Buttons must perform real state changes; no fake controls.
- The DSA binary-tree question must remain in the exam.
- BlurShield blurs **only the sensitive question and option layer**. A reference diagram, code snippet, table, graph, or tree must remain clear.
- No integrity signal can automatically fail, disqualify, accuse, or change marks for a candidate. An officer reviews factual evidence.
- Do not claim browser-side screenshot prevention, definitive facial identity, or production-grade anti-spoof liveness when the browser cannot honestly guarantee those things.

## Current state (read README.md for full detail)

The single-file demo was rebuilt into a multi-PC exam platform. Everything below works for real:

- Candidate login (ID + DOB), instructions + language, a real readiness gate, a 27-question paper (Aptitude, Technical/DSA with the binary-tree question, and Coding in JS/Python with full templates), palette statuses, submit.
- Every PC that signs in appears live in `/ops`, with progress, time left, heartbeat, camera/fullscreen, warnings, AI risk and signals.
- Real disruption detection: cable/Wi-Fi off, server down, heartbeat blocked, tab closed. The **timer pauses during the outage and resumes from the same value.** A cohort vs individual correlation feeds the remedy engine (recover / protect time / targeted reschedule), with officer approval for anything high-stakes.
- SHA-256 hash-chained evidence, a tamper test, and Fairness Receipts with QR codes and a `/verify` page.
- AI proctoring through Claude (`claude-opus-5-5`) with the key server-side in `.env`.

Run: `npm run dev` → http://localhost:5190 (landing), http://localhost:5190/exam (candidate) and http://localhost:5190/ops (admin). LAN hall: `npm run dev:lan`.

QA done: 5 parallel test agents covered network cuts, server crash/restart, a 5-PC hall, integrity/UI, and AI proctoring. The bugs they found were fixed; see the bottom of this file.

## Remaining work before final submission

### P0 — must finish for a credible production story

- [ ] **Backend-owned candidate sessions:** move `candidateStarted`, answers, checkpoints, assisted-review state, and integrity events out of browser-global demo state. Every candidate must have an isolated session ID.
- [ ] **Authentication and roles:** add candidate login, exam officer login, role-based access control, and a protected Control Tower route.
- [ ] **Durable evidence store:** persist checkpoints and audit events in a database with event IDs, candidate ID, timestamps, actor, decision state, and append-only semantics.
- [ ] **Server-signed evidence:** generate evidence hashes/signatures on the server, not only in the browser, so candidates cannot alter a local receipt.
- [ ] **HTTPS deployment:** camera/mic access must be tested on the final HTTPS deployment/domain, not only on localhost.
- [ ] **Five real-profile test:** test five independent browser profiles/candidate IDs simultaneously: answer save, clipboard event, fullscreen exit, camera loss, outage/recovery, and officer approval.
- [ ] **Actual-device testing:** test Chrome/Edge/Firefox/Safari where relevant, laptop webcam/mic permission denial, external camera unplug, slow internet, mobile fallback, and accessibility paths.

### P1 — high-impact hackathon improvements

- [ ] **Officer review queue:** show pending integrity/assisted-review cases with `clear`, `request more evidence`, `approve alternate path`, and `escalate` decisions.
- [ ] **Candidate communications:** add real-time status updates and an outage/recovery message centre; later connect SMS/email only after permissions and policy are defined.
- [ ] **Per-candidate remedy engine:** calculate actual affected cohort, preserved checkpoint count, outage time, and tailored Fair-Time recommendation instead of using demo constants.
- [ ] **Immutable evidence visualization:** add a simple event chain/tamper-evidence view that judges can understand in five seconds.
- [ ] **Accessibility:** keyboard-only flow, screen-reader announcements, colour-contrast audit, camera/fullscreen accommodations, and language support.
- [ ] **Candidate appeal view:** allow a candidate to see factual evidence and request a review without exposing other candidates' data.

### P2 — only if time remains

- [ ] Integrate a vetted anti-spoof/liveness provider after consent, privacy, retention, and human-review policies are agreed.
- [ ] Add anomaly correlation across sessions: same ISP/region/service path, answer-sync heartbeat loss, or proctoring-device failure clusters.
- [ ] Add multilingual candidate notices (Hindi + English first).
- [ ] Add a downloadable signed PDF Fairness Receipt in addition to JSON.
- [ ] Add simulated incident scenarios for demo: partial candidate impact, cohort outage, audio-device loss, and recovery conflict.

### Submission assets still needed

- [ ] 8–10 slide deck: problem → Indian exam context → solution → architecture → live flow → uniqueness → impact → roadmap.
- [ ] 90-second live-demo script with exact clicks and one backup recorded video.
- [ ] Solution synopsis/executive summary.
- [ ] Problem statement + proposed solution document.
- [ ] Innovation/differentiation note: why evidence-led fair recovery is different from generic proctoring.
- [ ] Impact/benefits document.
- [ ] Feasibility + implementation plan.
- [ ] Technical architecture diagram.
- [ ] Prototype/demo URL and repository URL.

### Final smoke test on submission day

1. Run `npm run build`.
2. Open Candidate + Control Tower in separate fresh browser profiles.
3. Verify camera/mic permission, DSA tree/reference clarity, clipboard block, and fullscreen signal.
4. Run assisted-review approval once.
5. Run outage → restore → approve → receipt once.
6. Reset demo and leave the candidate release gate open for judges.

## Working style expected from the next agent

- Keep the product differentiated through evidence-led recovery, not generic proctoring claims.
- Preserve the clear-reference / blurred-question rule.
- Keep all buttons functional.
- Keep privacy language honest.
- Never turn browser signals into automatic misconduct decisions.
