# InterviewAI — AI Video Interview Platform

> Automated first-round candidate screening via an AI interviewer that verbally asks questions and captures responses via real-time video/audio streaming.

---

## 1. Problem Understanding

Manual first-round interviews don't scale. Recruiters spend hours on repetitive screening calls that could be automated — while candidates have no flexible scheduling. InterviewAI solves this by:

- **Automating screening**: AI (GPT-4o + TTS) verbally asks role-specific questions
- **Capturing responses**: Real-time video/audio streaming with chunk-based resilience
- **Evaluating automatically**: Deepgram transcription → GPT-4o scoring → unified recruiter dashboard
- **Maintaining integrity**: Real-time proctoring (tab-switch detection, face absence monitoring)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 14)                     │
│  HardwareCheck → LiveInterview → Complete                    │
│  MediaRecorder API (5s chunks) → POST /api/chunk/upload      │
│  Socket.io /interview (proctoring, state sync)               │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                   BACKEND (Express + Node.js)                │
│  Routes: /interview, /chunk, /recruiter                      │
│  Socket.io: /interview namespace, /recruiter namespace       │
│  MongoDB (Mongoose): AiInterview, Candidate, Chunk           │
│  Redis: session cache, rate limiting                         │
└──────────┬─────────────────────────┬────────────────────────┘
           │ S3 PutObject             │ SQS SendMessage
┌──────────▼──────┐        ┌─────────▼────────────────────────┐
│  AWS S3 / R2    │        │  SQS FIFO Queues                  │
│  chunk_000.webm │        │  AUDIO_MERGE → TRANSCRIPTION      │
│  chunk_001.webm │        │  → EVALUATION → DLQ               │
│  merged.webm    │        └─────────┬────────────────────────┘
│  tts/q_xxx.mp3  │                  │ Lambda Workers
└─────────────────┘        ┌─────────▼────────────────────────┐
                            │  Worker 1: FFmpeg Merge           │
                            │  Worker 2: Deepgram Transcribe    │
                            │  Worker 3: GPT-4o Evaluate        │
                            └──────────────────────────────────┘
```

### Media Flow

```
Frontend
  └─ MediaRecorder (timeslice: 5000ms)
       └─ ondataavailable → blob (>1KB)
            └─ POST /api/chunk/upload (FormData)
                 └─ S3: interviews/{id}/{qId}/chunk_000.webm
                      └─ SQS: AUDIO_MERGE_QUEUE
                           └─ FFmpeg concat → merged.webm
                                └─ SQS: TRANSCRIPTION_QUEUE
                                     └─ Deepgram Nova-2 → transcript
                                          └─ SQS: EVALUATION_QUEUE
                                               └─ GPT-4o → score + feedback
                                                    └─ Socket emit → recruiter
```

### WebSocket Event Flow

```
Candidate                    Server                    Recruiter
    │── join_session ────────►│                            │
    │◄── session_state ───────│                            │
    │── recording_started ───►│                            │
    │── proctor_event ────────►│──── proctor_alert ───────►│
    │── recording_stopped ───►│                            │
    │                         │──── finalize_queued ──────►│
    │◄── next_question ───────│                            │
    │── next_question (last) ─►│                           │
    │◄── interview_complete ──│                            │
```

---

## 3. Technical Decisions & Tradeoffs

### Streaming over Full Upload
Chunks are uploaded every 5 seconds via `MediaRecorder(timeslice: 5000)`. If the session disconnects at 90%, we already have 90% of the recording. A full upload at the end risks losing everything on network failure.

### Chunk-Based Deterministic Keys
S3 keys follow `chunk_000.webm`, `chunk_001.webm` — padded 3-digit index. FFmpeg's concat demuxer re-orders them correctly even if they arrive out of sequence.

### Async Processing via SQS
Heavy tasks (FFmpeg, Deepgram, GPT-4o) are decoupled from the API. The main server stays responsive (<200ms response times) while workers scale horizontally.

### IndexedDB for Failed Chunks
Failed chunk uploads are persisted in IndexedDB with key `pending_chunk_{interviewId}_{questionId}_{index}`. On reconnect, the hook drains the queue before resuming normal recording.

---

## 4. Failure Scenarios & Recovery

| Scenario | Detection | Recovery |
|---|---|---|
| Network interruption | Fetch error in `uploadChunkWithRetry` | Exponential backoff (1s → 2s → 4s), save to IndexedDB |
| Duplicate chunks | `HeadObject` check before upload | Skip if S3 key already exists |
| Camera/mic disconnect | `track.onended` event | Show overlay, emit proctor event, allow retry |
| Partial upload failure | All retries exhausted | IDB persistence, drain on reconnect |
| WebSocket disconnect | `socket.on('disconnect')` | Auto-reconnect with backoff, re-emit `join_session` |
| Empty/corrupted chunks | `blob.size > 1000` + WAV/WebM header check | Skip upload, log warning, continue |
| Session refresh | `GET /api/interview/:id` | Resume from `session_data.currentQuestionIndex` |
| Worker failure | SQS visibility timeout + retry | Up to 3 retries → DLQ → CloudWatch alert |

---

## 5. Product Thinking

### Candidate Experience
- **Hardware Check page** validates camera, mic, speakers, and network before the interview starts — reducing mid-interview failures
- **AI speaks first** via pre-generated TTS audio, creating a natural conversational feel
- **Progress dots** show question number so candidates know where they are
- **Session resume** — if the page refreshes, the interview continues from exactly where it left off

### Recruiter Experience
- **Unified drill-down**: resume + video playback + transcript + AI scores in one view
- **Real-time proctoring feed** via Socket.io — see tab switches and face absences live
- **Suspicion score** (0–100) auto-calculated from proctoring events
- **Recommendation badges** (Strong Yes / Yes / Maybe / No) for fast triage

### Suspicious Activity Tracking
- Tab switches increment `proctoring.tabSwitchCount` via `visibilitychange` API
- Face absence detected via canvas pixel analysis every 3 seconds
- `suspiciousScore` = `(tabSwitches × 15) + (faceAbsences × 10) + (flags × 5)`, capped at 100
- All events timestamped and stored for recruiter timeline view

---

## 6. Scalability Considerations

| Bottleneck | Current | At Scale |
|---|---|---|
| Video chunk ingestion | Express + S3 | S3 Transfer Acceleration, CloudFront |
| Transcription queue | Lambda workers | Auto-scaling Lambda concurrency |
| WebSocket connections | Single EC2 | Socket.io with Redis adapter + multiple nodes |
| DB reads (recruiter list) | MongoDB | Add indexes + Redis cache for paginated results |
| TTS pre-generation | Synchronous on create | Pre-generate in background job |

---

## 7. Observability & Debugging

- **CloudWatch** structured logs on every pipeline step: `[MergeWorker]`, `[TranscribeWorker]`, `[EvaluateWorker]`
- **DLQ monitoring**: CloudWatch alarm fires when DLQ message count > 0
- **processingStatus field** on each response: `pending → merging → transcribing → evaluating → done | failed`
- **reconnectCount** in `session_data` tracks unstable connections
- **Socket disconnect reason** logged with timestamp in `proctoring.flags`

---

## 8. AI Usage Documentation

| What | How AI Was Used | Human Decision |
|---|---|---|
| SQS queue architecture | AI suggested FIFO queues with deduplication IDs | Chose 3-queue pipeline (merge → transcribe → evaluate) |
| FFmpeg concat approach | AI provided concat demuxer command | Validated against FFmpeg docs, added error handling |
| Chunk recovery strategy | AI suggested IndexedDB for failed chunks | Added IDB key naming convention and drain-on-reconnect logic |
| GPT-4o evaluation prompt | AI drafted initial prompt | Refined scoring rubric, added JSON response_format |
| Face detection heuristic | AI suggested skin-tone pixel approach | Chose 3% threshold after testing |
| Socket.io reconnect config | AI provided config params | Set Infinity reconnection attempts for interview reliability |

**Prompting approach**: "Understand → Explore → Decide" — first understood the constraint (streaming resilience), explored options (WebRTC, chunked HTTP, WebSocket binary), then decided based on browser compatibility and retry semantics.

---

## 9. Setup Instructions

### Prerequisites
- Node.js 20+, Docker, FFmpeg installed locally

### 1. Clone & Install
```bash
git clone <repo>
cd interview-ai
npm install   # installs all workspaces
```

### 2. Start Infrastructure
```bash
docker-compose up -d
# MongoDB: localhost:27017
# Redis: localhost:6379
# LocalStack (S3/SQS): localhost:4566
```

### 3. Environment Setup
```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
# Fill in your API keys
```

### 4. Create LocalStack S3 bucket + SQS queues (dev)
```bash
aws --endpoint-url=http://localhost:4566 s3 mb s3://interview-ai-media --region ap-south-1
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name interview-merge.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name interview-transcribe.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name interview-evaluate.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
```

### 5. Run Dev Servers
```bash
# Terminal 1 — Backend
cd apps/server && npm run dev

# Terminal 2 — Frontend
cd apps/web && npm run dev
```

### 6. Open
- Candidate: `http://localhost:3000/interview/{sessionId}/hardware-check`
- Recruiter: `http://localhost:3000/dashboard/recruiter`

---

## 10. Project Structure

```
interview-ai/
├── apps/
│   ├── web/                    # Next.js 14 frontend
│   │   ├── app/interview/      # Hardware check, Live, Complete pages
│   │   ├── hooks/              # useMediaRecorder, useWebSocket, useProctoring
│   │   └── components/         # VideoRecorder, AIAvatar, TimerBar
│   └── server/                 # Express backend
│       ├── src/routes/         # interview.routes.ts
│       ├── src/models/         # AiInterview, Candidate, Chunk
│       ├── src/services/       # chunk.service.ts
│       ├── src/workers/        # merge-worker, transcribe-worker
│       └── src/socket/         # interview.socket.ts
└── packages/
    └── shared-types/           # Shared TypeScript interfaces
```
