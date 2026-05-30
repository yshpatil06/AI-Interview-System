export type InterviewStatus =
  | "created"
  | "hardware_check"
  | "in_progress"
  | "paused"
  | "processing"
  | "completed"
  | "failed";

export type SuspiciousEventType =
  | "tab_switch"
  | "face_absent"
  | "multiple_faces"
  | "copy_paste"
  | "devtools_open"
  | "window_blur";

export interface SuspiciousEvent {
  id: string;
  type: SuspiciousEventType;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Question {
  id: string;
  text: string;
  category: "behavioral" | "technical" | "culture";
  timeLimitSec: number;
}

export interface AnswerRecord {
  questionId: string;
  chunkIds: string[];
  startedAt: string;
  endedAt?: string;
  transcript?: string;
  mergeStatus: "pending" | "merging" | "done" | "failed";
}

export interface SessionData {
  currentQuestionIndex: number;
  answers: AnswerRecord[];
  suspiciousEvents: SuspiciousEvent[];
  lastChunkSequence: number;
  receivedChunkSequences: number[];
  hardwareVerified: boolean;
  resumeToken: string;
}

export interface AiInterview {
  id: string;
  candidateName: string;
  candidateEmail: string;
  role: string;
  status: InterviewStatus;
  session_data: SessionData;
  createdAt: string;
  updatedAt: string;
  mergedMediaPath?: string;
  fullTranscript?: string;
  aiScore?: number;
  aiSummary?: string;
}

export type WsClientMessage =
  | { type: "auth"; sessionId: string; resumeToken: string }
  | { type: "chunk"; questionId: string; sequence: number; mimeType: string; data: string }
  | { type: "chunk_ack_request"; questionId: string }
  | { type: "proctor"; event: SuspiciousEventType; metadata?: Record<string, unknown> }
  | { type: "heartbeat" }
  | { type: "question_complete"; questionId: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "auth_ok"; missingChunks: number[]; session: Partial<AiInterview> }
  | { type: "auth_fail"; reason: string }
  | { type: "chunk_ack"; sequence: number; duplicate?: boolean }
  | { type: "missing_chunks"; sequences: number[] }
  | { type: "question_advanced"; index: number }
  | { type: "interview_complete" }
  | { type: "error"; message: string }
  | { type: "pong" };

export const DEFAULT_QUESTIONS: Question[] = [
  {
    id: "q1",
    text: "Tell us about a challenging project you led and how you measured success.",
    category: "behavioral",
    timeLimitSec: 120,
  },
  {
    id: "q2",
    text: "Explain how you would design a scalable API for real-time video chunk ingestion.",
    category: "technical",
    timeLimitSec: 180,
  },
  {
    id: "q3",
    text: "Describe a time you disagreed with a teammate. How did you resolve it?",
    category: "culture",
    timeLimitSec: 120,
  },
];
