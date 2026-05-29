export type InterviewStatus =
  | 'pending'
  | 'hardware_check'
  | 'in_progress'
  | 'processing'
  | 'completed'
  | 'failed';

export type ProcessingStatus =
  | 'pending'
  | 'merging'
  | 'transcribing'
  | 'evaluating'
  | 'done'
  | 'failed';

export type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no';

export interface IQuestion {
  questionId: string;
  text: string;
  audioUrl: string;
  order: number;
  maxDuration: number; // seconds
}

export interface IResponse {
  questionId: string;
  chunkKeys: string[];
  mergedKey: string;
  transcript: string;
  aiScore: number;
  aiFeedback: string;
  processingStatus: ProcessingStatus;
}

export interface IProctoring {
  tabSwitchCount: number;
  faceAbsenceEvents: Array<{ timestamp: Date; duration: number }>;
  suspiciousScore: number;
  flags: string[];
}

export interface IEvaluation {
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  summary: string;
  recommendation: Recommendation;
}

export interface ISessionData {
  currentQuestionIndex: number;
  startedAt: Date;
  lastActiveAt: Date;
  reconnectCount: number;
  timePerQuestion: number[];
}

export interface IAiInterview {
  _id: string;
  jobId: string;
  candidateId: string;
  recruiterId: string;
  status: InterviewStatus;
  session_data: ISessionData;
  questions: IQuestion[];
  responses: IResponse[];
  proctoring: IProctoring;
  evaluation: IEvaluation;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICandidate {
  _id: string;
  name: string;
  email: string;
  resumeUrl: string;
  linkedinUrl?: string;
  interviews: string[];
}

export interface IChunk {
  interviewId: string;
  questionId: string;
  chunkIndex: number;
  s3Key: string;
  size: number;
  checksum: string;
  uploadedAt: Date;
  isCorrupted: boolean;
}

// Socket event types
export type ProctorEventType =
  | 'TAB_SWITCH'
  | 'FACE_ABSENT'
  | 'FACE_PRESENT'
  | 'DISCONNECT'
  | 'RECONNECT';

export interface ProctorEvent {
  type: ProctorEventType;
  sessionId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface SessionState {
  currentQuestionIndex: number;
  timeRemaining: number;
  status: InterviewStatus;
  question: IQuestion | null;
}

// SQS Job payloads
export interface MergeJobPayload {
  interviewId: string;
  questionId: string;
  totalChunks: number;
}

export interface TranscribeJobPayload {
  interviewId: string;
  questionId: string;
  mergedKey: string;
}

export interface EvaluateJobPayload {
  interviewId: string;
  questionId: string;
  transcript: string;
  questionText: string;
  jobDescription: string;
}
