# ExamShield

A browser exam platform (Infosys/TCS-style) built around one idea: when an exam session is disrupted, prove what happened, pause the candidate's clock, keep every answer, and give a fair, officer-approved, verifiable remedy.



<img width="1536" height="1024" alt="Examshield" src="https://github.com/user-attachments/assets/9286fb4f-734e-4292-a2a1-a063912601fe" />

## Run

```bash
npm install
cp .env.example .env        # put your ANTHROPIC_API_KEY in .env (optional: enables AI proctoring)
npm run dev                  # http://localhost:5190
```

| URL | Who |
| --- | --- |
| `http://localhost:5190/` | Landing page (Three.js hero, product story, live receipt demo) |
| `http://localhost:5190/exam` | Candidate exam (each browser tab/PC is one candidate) |
| `http://localhost:5190/ops` | Exam Control Tower (admin). Keep it open: it also runs the heartbeat watchdog |
| `http://localhost:5190/verify?r=<receipt>` | Fairness Receipt verification (the receipt QR opens this) |

Demo logins (Candidate ID / DOB): `EXM-20841 / 14082004`, `EXM-20854 / 02112003`, `EXM-20873 / 17072004`, `EXM-20891 / 19092003`. Full roster: `src/data/paper.ts`.

### Exam hall with several PCs (LAN)

```bash
npm run dev:lan              # https://<this-machine-ip>:5190 (self-signed cert)
```

Other PCs need HTTPS for the camera, so accept the certificate warning once on each PC. Every PC that signs in shows up live in `/ops`.

## What a candidate goes through

1. **Login** with Candidate ID + date of birth.
2. **Instructions**: section table, palette legend, the rules, question language (English/Hindi), and the declaration.
3. **Readiness gate**. These checks are real, and the timer does not start until they pass:
   - paper manifest hash and version
   - language pack
   - timer drift
   - IndexedDB write/read save channel
   - HTTP heartbeat to the exam server
   - camera + mic, a random live-presence motion check, and fullscreen

   If a camera/fullscreen accommodation is needed, the candidate uses the assisted path, and an officer must approve it.
4. **Exam**, with 27 questions:
   - **Sections:** Aptitude 12, Technical/DSA 12, Coding 3.
   - **Palette:** Not visited / Not answered / Answered / Marked / Answered & marked, plus Save & Next, Mark for Review & Next, Clear Response, and Save & Finish on the last question.
   - **Answers:** every choice is a sequenced checkpoint, written to IndexedDB first and then to the server.
   - **Coding:** LeetCode-style function templates in **JavaScript and Python**, with locked driver code. Python is real CPython (Pyodide, first run downloads it from jsDelivr). Code runs against sample and hidden tests, with time limits.
   - **BlurShield:** only the area under the pointer or keyboard focus is sharp, Alt+R gives a wider lens, and a rotating session/time watermark is always present. The binary-tree reference is never blurred.
   - **Integrity signals (review-only, never auto-penalised):**
     - fullscreen exit and tab switch, with a warning modal
     - focus loss
     - copy/cut/paste/right-click/drag
     - external paste into the editor
     - camera unplugged or covered
     - AI proctor flags
5. **Submit**: a section-wise summary, then the submitted page with a response digest and any Fairness Receipts.

## Disruptions: detect → pause → preserve → remedy → receipt

- **Detection.** The candidate browser sends a heartbeat every 2 s: a real HTTP round trip, plus the simulated exam API. A lost heartbeat can come from:
  - a cable or Wi-Fi drop (`navigator.onLine`)
  - the server going down
  - an API outage

  In `/ops`, the watchdog also catches silent PCs (tab closed, crash, power loss) after 8 s.
- **Pause.** While the connection is lost, the candidate's **timer freezes** and resumes from the same value. The overlay is `inert`, so no answering happens behind it. Answers are already safe in IndexedDB. Saves made during the drop are queued and reconciled on recovery.
- **Correlation.** Two or more PCs on the same service path losing heartbeat within 30 s count as a **shared outage** (cohort). Otherwise it is an individual issue.
- **Remedy engine.** An officer must approve anything high-stakes. No marks are ever changed.
  - `Recover`: a single candidate, within the 20 s grace. Auto-applied, because the timer already paused.
  - `Protect time`: a longer or shared outage. The officer approves a 30 s re-orientation buffer, plus any time the browser could not freeze.
  - `Targeted reschedule`: the outage exceeds the threshold (3 min), there are unreconciled answers, or the remaining time is too short. Only the affected candidates are rescheduled.
- **Evidence.**
  - Every event is sealed with SHA-256 and chained. The Evidence Vault shows chain status, lets you export it, and has a tamper test.
  - Each affected candidate gets a **Fairness Receipt** containing: incident, measured interval, answers preserved, remedy, reason, officer, receipt hash, and chain head. It also has a QR code linking to `/verify`.
  - If any recorded event is edited, verification fails.

## AI proctoring (Claude)

- **How it works.** The browser sends one downscaled webcam frame every `PROCTOR_INTERVAL_SECONDS` (default 30 s), and also sends one when the candidate returns to the tab.
- **Where it goes.** The frame goes to `/api/proctor` on this server. The server calls `claude-opus-5-5` with structured output: faces, presence, looking away, device, another person, obstruction, and risk.
- **Key safety.** The API key stays server-side in `.env`. Frames are never stored.
- **Results.** Results are review-only events for an officer. Cost guards:
  - roster-only candidate IDs
  - 4 s per-candidate gap
  - 60 calls per minute globally

## Develop

```bash
npm test          # core logic self-check (remedy engine, hash chain, merge, timer freeze)
npm run build     # typecheck + production build
```

| Path | What |
| --- | --- |
| `src/lib/core.ts` | Types, hash chain, receipt verification, multi-PC merge, remedy engine, timer |
| `src/state.ts` | Sync (BroadcastChannel + WebSocket relay + IndexedDB), heartbeat, watchdog, all actions |
| `src/candidate.tsx` | Login, instructions, readiness gate, exam, coding editor, submit |
| `src/ops.tsx` | Control Tower: live sessions, incidents and remedies, simulation, evidence vault |
| `src/hooks/useIntegrity.ts` | Camera/mic, liveness, fullscreen, obstruction check, AI proctor loop |
| `src/lib/runner.ts` | JS (Web Worker) and Python (Pyodide worker) code runners |
| `server/proctor.ts` | `/api/heartbeat`, `/api/proctor` (Claude vision) |
| `vite.config.ts` | Dev server, WebSocket relay, HTTPS LAN mode |

## Honest boundaries

- **Who is the server.** The dev server plus `/ops` act as the exam server. A production deployment needs:
  - an authenticated backend-owned session store
  - officer login
  - server-side signing of receipts
- **Liveness and AI checks.** The live-presence check and the AI observations are integrity signals, not biometric identity verification.
- **What a browser cannot block.** OS screenshots, a second phone, or all screen recording.
