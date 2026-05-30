# AI Video Interview — Implementation Plan

## Conversation Summary

Built **Nexus Interview**, a full-stack AI video screening platform with:

- **Monorepo**: `apps/web` (Next.js 14 + React Three Fiber), `apps/server` (Express + WebSocket), `packages/shared` (types).
- **Black/gray 3D landing** with animated icosahedron, torus ring, and star field.
- **Candidate flow**: start → hardware check → live room with MediaRecorder chunk streaming.
- **Recruiter dashboard**: list sessions, proctoring flags, transcripts, video playback.

## Phases Completed

1. Shared domain types (`AiInterview`, `session_data`, WebSocket message contracts).
2. Backend persistence (JSON on disk), chunk handler with duplicate/empty rejection, merge queue, mock Deepgram.
3. WebSocket auth + reconnect + missing chunk recovery.
4. Frontend proctoring hooks (visibility, blur, copy, brightness heuristic for face absence).
5. README with mandatory assignment sections.

## Next Steps (Production Hardening)

- Deploy web to Vercel, API to Railway/Fly with persistent volume or S3/R2 for chunks.
- Replace in-process merge with SQS + Lambda + FFmpeg.
- Integrate real face detection (TensorFlow.js or server-side).
- Add authentication for recruiter routes.

## Submission Checklist

- [ ] Record walkthrough video (architecture + AI usage).
- [ ] Deploy and paste live URL in README.
- [ ] Optional: set `DEEPGRAM_API_KEY` for real transcription.
