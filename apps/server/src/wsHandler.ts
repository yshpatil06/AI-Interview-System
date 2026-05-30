import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import type { WsClientMessage, WsServerMessage, SuspiciousEvent } from "@ai-interview/shared";
import { DEFAULT_QUESTIONS } from "@ai-interview/shared";
import { saveChunk, getMissingSequences } from "./chunkHandler";
import { config } from "./config";
import { logger } from "./logger";
import { finalizeInterview } from "./mergeQueue";
import { getInterview, updateInterview } from "./store";

type AuthedSocket = WebSocket & { sessionId?: string };

export function handleWsMessage(ws: AuthedSocket, raw: string): void {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(raw) as WsClientMessage;
  } catch {
    send(ws, { type: "error", message: "invalid_json" });
    return;
  }

  switch (msg.type) {
    case "ping":
      send(ws, { type: "pong" });
      return;
    case "heartbeat":
      return;
    case "auth":
      void handleAuth(ws, msg.sessionId, msg.resumeToken);
      return;
    case "chunk":
      void handleChunk(ws, msg);
      return;
    case "chunk_ack_request":
      void handleChunkAckRequest(ws, msg.questionId);
      return;
    case "proctor":
      void handleProctor(ws, msg.event, msg.metadata);
      return;
    case "question_complete":
      void handleQuestionComplete(ws, msg.questionId);
      return;
    default:
      send(ws, { type: "error", message: "unknown_message_type" });
  }
}

function send(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function handleAuth(
  ws: AuthedSocket,
  sessionId: string,
  resumeToken: string
): Promise<void> {
  const interview = getInterview(sessionId);
  if (!interview || interview.session_data.resumeToken !== resumeToken) {
    send(ws, { type: "auth_fail", reason: "invalid_session" });
    return;
  }

  ws.sessionId = sessionId;
  const qIndex = interview.session_data.currentQuestionIndex;
  const questionId = DEFAULT_QUESTIONS[qIndex]?.id ?? DEFAULT_QUESTIONS[0].id;
  const maxSeq = interview.session_data.lastChunkSequence;
  const missing = await getMissingSequences(sessionId, questionId, maxSeq);

  send(ws, {
    type: "auth_ok",
    missingChunks: missing,
    session: {
      id: interview.id,
      status: interview.status,
      session_data: interview.session_data,
    },
  });

  logger.info({ sessionId, missing: missing.length }, "WebSocket reconnected / auth ok");
}

async function handleChunk(
  ws: AuthedSocket,
  msg: Extract<WsClientMessage, { type: "chunk" }>
): Promise<void> {
  if (!ws.sessionId) {
    send(ws, { type: "error", message: "not_authenticated" });
    return;
  }

  const interview = getInterview(ws.sessionId);
  if (!interview) {
    send(ws, { type: "error", message: "session_not_found" });
    return;
  }

  const result = await saveChunk({
    interview,
    questionId: msg.questionId,
    sequence: msg.sequence,
    base64: msg.data,
    mimeType: msg.mimeType,
  });

  if (!result.ok) {
    send(ws, { type: "error", message: result.reason ?? "chunk_failed" });
    return;
  }

  send(ws, {
    type: "chunk_ack",
    sequence: msg.sequence,
    duplicate: result.duplicate,
  });
}

async function handleChunkAckRequest(ws: AuthedSocket, questionId: string): Promise<void> {
  if (!ws.sessionId) return;
  const interview = getInterview(ws.sessionId);
  if (!interview) return;
  const missing = await getMissingSequences(
    ws.sessionId,
    questionId,
    interview.session_data.lastChunkSequence
  );
  send(ws, { type: "missing_chunks", sequences: missing });
}

async function handleProctor(
  ws: AuthedSocket,
  eventType: SuspiciousEvent["type"],
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!ws.sessionId) return;
  const interview = getInterview(ws.sessionId);
  if (!interview) return;

  const event: SuspiciousEvent = {
    id: nanoid(8),
    type: eventType,
    timestamp: new Date().toISOString(),
    metadata,
  };

  const events = [...interview.session_data.suspiciousEvents, event];
  await updateInterview(ws.sessionId, {
    session_data: { ...interview.session_data, suspiciousEvents: events },
  });

  logger.info({ sessionId: ws.sessionId, eventType }, "Proctoring event");
}

async function handleQuestionComplete(ws: AuthedSocket, _questionId: string): Promise<void> {
  if (!ws.sessionId) return;
  const interview = getInterview(ws.sessionId);
  if (!interview) return;

  const nextIndex = interview.session_data.currentQuestionIndex + 1;
  if (nextIndex >= DEFAULT_QUESTIONS.length) {
    await updateInterview(ws.sessionId, { status: "processing" });
    send(ws, { type: "interview_complete" });
    void finalizeInterview(ws.sessionId);
    return;
  }

  await updateInterview(ws.sessionId, {
    session_data: {
      ...interview.session_data,
      currentQuestionIndex: nextIndex,
      receivedChunkSequences: [],
      lastChunkSequence: -1,
    },
  });

  send(ws, { type: "question_advanced", index: nextIndex });
}

export function handleWsClose(ws: AuthedSocket): void {
  if (ws.sessionId) {
    logger.info({ sessionId: ws.sessionId }, "WebSocket closed — chunks persisted on disk");
  }
}
