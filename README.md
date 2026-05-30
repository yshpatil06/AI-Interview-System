# Nexus Interview — AI Video Interview System

> **Live demo:** _Deploy and add your URL here_  
> **Walkthrough video:** _Add link after recording_  
> **Submission date:** May 30, 2026

Automated first-round video screening: an AI interviewer asks questions, candidates respond on camera, media streams in real time, and recruiters review transcripts, playback, and proctoring signals in one dashboard.

---

## Table of Contents

1. [Problem Understanding](#1-problem-understanding)
2. [Architecture Overview](#2-architecture-overview)
3. [Technical Decisions & Tradeoffs](#3-technical-decisions--tradeoffs)
4. [Failure Scenarios & Edge Cases](#4-failure-scenarios--edge-cases)
5. [Recovery Mechanisms](#5-recovery-mechanisms)
6. [Product Thinking](#6-product-thinking)
7. [Scalability Considerations](#7-scalability-considerations)
8. [Observability & Debugging](#8-observability--debugging)
9. [AI Usage Documentation](#9-ai-usage-documentation)
10. [Demo & Walkthrough](#10-demo--walkthrough)
11. [Setup Instructions](#setup-instructions)

---

## 1. Problem Understanding

### What problem are you solving?

Manual first-round interviews do not scale. Recruiters spend hours on repetitive screens while strong candidates wait in queue. Video async tools often fail on poor networks or lose entire recordings when a session drops.

### Why is this system needed?

Recruiters need **high-fidelity, reviewable** evidence of communication and technical thinking for hundreds of candidates **asynchronously**. Candidates need a **fair, low-friction** experience that survives disconnects and does not require installing desktop software.

**Nexus Interview** automates:

- Question delivery (browser TTS today; swappable for ElevenLabs/Deepgram TTS)
- **Streaming** capture of answers via `MediaRecorder` chunks
- **Durable storage** and merge for playback
- **Speech-to-text** (Deepgram when configured)
- **Integrity signals** (tab switch, blur, face-absence heuristic)

---

## 2. Architecture Overview

### High-level system architecture

```
┌─────────────────┐     WebSocket + REST      ┌──────────────────┐
│  Next.js Web    │ ◄──────────────────────► │  Express API     │
│  (React 3D UI)  │   chunks, proctoring      │  + ws server     │
└────────┬────────┘                           └────────┬─────────┘
         │ MediaRecorder                              │ write
         ▼ chunks                                     ▼
┌─────────────────┐                           ┌──────────────────┐
│  Browser A/V    │                           │  Disk / S3 / R2  │
│  Hardware check │                           │  chunk_NNN.webm  │
└─────────────────┘                           └────────┬─────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │  Merge queue     │
                                              │  (→ FFmpeg prod) │
                                              └────────┬─────────┘
                                                       ▼
                                              ┌──────────────────┐
                                              │  Deepgram STT    │
                                              └────────┬─────────┘
                                                       ▼
                                              ┌──────────────────┐
                                              │  Recruiter UI    │
                                              └──────────────────┘
```

| Layer | Technology |
|--------|------------|
| Frontend | Next.js 14, React Three Fiber, Framer Motion |
| API | Express, `ws`, Pino logging |
| Shared types | `@ai-interview/shared` |
| Storage (demo) | `data/sessions/{id}/chunks/` |
| Storage (prod path) | S3 / Cloudflare R2 |
| Transcription | Deepgram API (optional) |

### Media flow (frontend → backend → storage → transcription)

1. **Frontend** — `MediaRecorder` emits `Blob` every **2.5s** (`CHUNK_MS`).
2. **Streaming** — Each blob is base64-encoded and sent over **WebSocket** (`type: "chunk"`) with `questionId` + monotonic `sequence`.
3. **Storage** — Server writes `chunk_000042.webm` under `sessions/{id}/chunks/{questionId}/`. Duplicates and sub-100-byte chunks are rejected.
4. **Processing** — On question/interview complete, **merge queue** concatenates valid chunks into `merged/{questionId}.webm`.
5. **Transcription** — Merged buffer POSTed to Deepgram when `DEEPGRAM_API_KEY` is set; otherwise demo placeholder text.

### WebSocket / event flow

| Client → Server | Purpose |
|-----------------|--------|
| `auth` | Bind socket to `sessionId` + `resumeToken` |
| `chunk` | Stream media segment |
| `chunk_ack_request` | Ask for missing sequences after reconnect |
| `proctor` | Tab switch, face absent, blur, copy |
| `question_complete` | Advance question index |
| `heartbeat` | Keep-alive |

| Server → Client | Purpose |
|-----------------|--------|
| `auth_ok` + `missingChunks` | Resume state after reconnect |
| `chunk_ack` | Confirm write (note `duplicate`) |
| `missing_chunks` | List sequences to re-send |
| `question_advanced` | UI moves to next question |
| `interview_complete` | Trigger final merge + scoring |

**REST fallback:** `POST /api/interviews/:id/chunk` for environments that block WebSockets.

---

## 3. Technical Decisions & Tradeoffs

### Why streaming over full upload?

- **Resilience:** If the network drops at minute 9 of 10, chunks 0–N are already on disk.
- **Memory:** Avoids holding a 200MB+ blob in RAM before upload.
- **Latency:** Recruiters can begin processing earlier; merge runs async.

**Tradeoff:** More server complexity (ordering, dedup, merge). Mitigated with deterministic filenames and sequence numbers.

### Why this architecture (Express + WS + Next)?

- **Separation:** Long-lived WebSocket connections stay on a dedicated Node process; Next.js focuses on UI and SSR.
- **Upgrade path:** Chunk paths and queue names mirror production (`AUDIO_MERGE_QUEUE`, Lambda workers) without over-building the demo.
- **Shared types:** One package prevents client/server drift on `session_data`.

### Why disk storage in the demo?

Zero cloud credentials for evaluators. Production swaps `chunkHandler` write target for S3/R2 presigned URLs.

### Why browser TTS for the “AI interviewer”?

Instant demo without API keys. Replace with Deepgram/ElevenLabs for production voice quality.

---

## 4. Failure Scenarios & Edge Cases

| Scenario | Risk | Mitigation in codebase |
|----------|------|------------------------|
| **Network interruptions** | WS drops mid-chunk | Exponential backoff reconnect; chunk queue on client; `auth_ok.missingChunks` |
| **Duplicate chunks** | Double write / storage bloat | `receivedChunkSequences` dedup; `chunk_ack.duplicate` |
| **Camera/mic disconnect** | `MediaRecorder` error | `track ended` listener → proctor event + UI flag |
| **Partial upload failures** | Disk write error | `saveChunk` returns `write_failed`; client can retry same sequence |
| **WebSocket reconnects** | Stale auth | Re-`auth` on every `onopen`; flush outbound queue |
| **Empty/corrupted chunks** | FFmpeg/merge break | `CHUNK_MIN_BYTES` (100) rejection; merge skips tiny buffers |

---

## 5. Recovery Mechanisms

### Reconnects

`InterviewSocket` reconnects up to 8 times with exponential backoff (max 15s). On `auth_ok`, server returns **missing chunk indices**; client calls `chunk_ack_request` to reconcile.

### Retry / recovery logic

- Outbound WS messages **queued** until socket is open.
- HTTP `POST .../chunk` available as alternate transport.
- Session brain: `AiInterview.session_data` persisted to `data/sessions/{id}.json` on every chunk.

### Chunk recovery strategy

- Filenames: `chunk_{sequence.padStart(6,'0')}.webm` — sortable regardless of arrival order.
- `getMissingSequences()` scans disk vs expected range.
- Duplicates: idempotent ack without double-counting.

### Failure handling approach

- Per-chunk: fail fast with reason (`chunk_too_small`, `invalid_base64`).
- Per-question merge: `mergeStatus: failed` if zero valid chunks.
- Interview: `status: failed | completed` with `aiSummary` for recruiter review.

---

## 6. Product Thinking

### Recruiter experience

- **Single dashboard:** candidate info, score, summary, per-question transcript + `<video>` playback, proctoring timeline.
- **Drill-down:** select any session from list; flags surfaced before watching full video.

### Candidate experience

- **Hardware check** gate reduces “I can’t hear you” support load.
- **Black/gray 3D brand** — focused, professional, not playful.
- **Visible WS status** — transparency when reconnecting.
- **Resume URL** — `?token=` + `session_data.resumeToken` (shareable secure link pattern).

### Suspicious activity tracking

| Event | Detection |
|-------|-----------|
| `tab_switch` | `document.visibilitychange` |
| `window_blur` | `window.blur` |
| `copy_paste` | `copy` event |
| `face_absent` | Canvas brightness heuristic + camera track ended |

Stored in `session_data.suspiciousEvents[]` with timestamp; reflected in AI score penalty.

### UX decisions

- AI speaks question before “Start answer” (reduces talking over the prompt).
- 2.5s chunks balance overhead vs recovery granularity.
- Post-interview confirmation screen sets expectations on processing time.

---

## 7. Scalability Considerations

### What may break at scale

- **Single-node disk I/O** — thousands of concurrent chunk writes.
- **In-process merge queue** — CPU-bound; one worker.
- **JSON session files** — not ideal for concurrent updates (use Postgres + row locks).
- **WebSocket fan-out** — sticky sessions required behind load balancers.

### Performance bottlenecks

- Base64 over WS (~33% overhead) — production: binary frames or S3 multipart.
- Merge via `Buffer.concat` — production: FFmpeg stream merge.
- Recruiter list loads all interviews — paginate + index by status.

### Future improvements for high concurrency

- S3/R2 presigned **direct upload** from browser.
- **SQS** `TRANSCRIPTION_QUEUE` + Lambda FFmpeg workers.
- **Redis** for session locks and chunk bitmaps.
- **CDN** for merged playback.
- Horizontal **API** replicas with Redis pub/sub for WS.

---

## 8. Observability & Debugging

### Logging strategy

- **Pino** structured logs on server (`chunk saved`, `proctor event`, `merge complete`, `WS reconnect`).
- `LOG_LEVEL=debug` for chunk-level traces in development.

### Error tracking

- Failed chunks log `write_failed` with path.
- Deepgram failures fall back to demo transcript with `logger.warn`.
- Client surfaces recorder errors and proctor flags in-sidebar.

### Debugging production failures

1. Find `sessionId` in recruiter dashboard.
2. Inspect `data/sessions/{id}.json` for `receivedChunkSequences` vs `suspiciousEvents`.
3. List `chunks/{questionId}/` — gaps in `chunk_*` numbering explain playback issues.
4. Check merged file size under `merged/`.
5. Correlate timestamps in logs with proctor events.

---

## 9. AI Usage Documentation

### How AI tools were used

| Area | AI assistance | Human decision |
|------|---------------|----------------|
| Monorepo scaffolding | Suggested workspace layout | Approved Express+WS split vs all-in-Next |
| WebSocket contract | Draft message types | Reviewed for idempotency + resume |
| 3D hero scene | R3F component patterns | Chose black/gray palette + icosahedron |
| README structure | Mapped to rubric sections | Filled with actual implementation details |
| Scoring heuristic | Brainstorm factors | Implemented simple penalty/bonus formula |

### Prompt / thought process

1. **Understand** — “What must survive a 30s network drop?”
2. **Explore** — Compared full upload vs 1s vs 2.5s chunks.
3. **Decide** — Streaming + deterministic keys + merge queue.

Example prompts used during build:

- “Design WebSocket messages for chunk ack and reconnect with missing sequence list.”
- “List failure modes for MediaRecorder chunk pipelines and mitigations.”

### Yours vs AI-assisted

- **Yours:** Product flows (hardware check → room → dashboard), proctoring event taxonomy, theme, chunk size, score formula.
- **AI-assisted:** Boilerplate, type definitions, documentation phrasing, Three.js starter mesh.

All evaluation/scoring logic was kept intentionally simple and **manually reviewed** — not auto-trusted for hiring decisions.

---

## 10. Demo & Walkthrough

### Setup instructions

See [Setup Instructions](#setup-instructions) below.

### Demo video

_Record a 5–10 min walkthrough covering:_

1. Landing 3D experience  
2. Candidate flow + chunk streaming  
3. Simulated disconnect (toggle offline) + reconnect  
4. Recruiter dashboard review  
5. How you used AI in your workflow  

**Place link here:** `TODO: https://...`

### Live link

**Place deployed URL here:** `TODO: https://your-app.vercel.app`

Recommended deploy:

- **Web:** Vercel (`apps/web`, set `NEXT_PUBLIC_*` env vars)  
- **API:** Railway / Render (`apps/server`, mount volume for `data/`)

---

## Setup Instructions

### Prerequisites

- Node.js 20+
- npm 10+
- Microphone + camera (for live demo)

### Install

```bash
git clone <your-repo>
cd ai-interview
cp .env.example .env
npm install
npm run build -w @ai-interview/shared
```

### Run locally

```bash
# Terminal 1 — API + WebSocket on :4000
npm run dev -w @ai-interview/server

# Terminal 2 — Web on :3000
npm run dev -w @ai-interview/web
```

Or both:

```bash
npm run dev
```

### Environment

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default 4000) |
| `PUBLIC_WEB_URL` | CORS + join links |
| `DEEPGRAM_API_KEY` | Optional real STT |
| `NEXT_PUBLIC_API_URL` | Browser REST base |
| `NEXT_PUBLIC_WS_URL` | Browser WS base |

### Quick test flow

1. Open http://localhost:3000  
2. **Begin as Candidate** → fill form → hardware check → interview room  
3. Answer 3 questions (Start answer → Finish answer)  
4. Open http://localhost:3000/recruiter → select session → watch playback  

### Project structure

```
ai-interview/
├── apps/
│   ├── server/          # Express + WebSocket + merge queue
│   └── web/             # Next.js UI + 3D landing
├── packages/shared/     # Types + DEFAULT_QUESTIONS
├── data/sessions/       # Runtime session storage (gitignored)
├── staticfiles/         # Planning docs
└── README.md
```

---

## License

MIT — for evaluation and portfolio use.
