import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import type { AiInterview, SessionData } from "@ai-interview/shared";
import { DEFAULT_QUESTIONS } from "@ai-interview/shared";
import { config } from "./config";
import { logger } from "./logger";

const interviews = new Map<string, AiInterview>();

function defaultSession(): SessionData {
  return {
    currentQuestionIndex: 0,
    answers: DEFAULT_QUESTIONS.map((q) => ({
      questionId: q.id,
      chunkIds: [],
      startedAt: new Date().toISOString(),
      mergeStatus: "pending",
    })),
    suspiciousEvents: [],
    lastChunkSequence: -1,
    receivedChunkSequences: [],
    hardwareVerified: false,
    resumeToken: nanoid(24),
  };
}

export async function initStore(): Promise<void> {
  await fs.mkdir(config.sessionsDir, { recursive: true });
  try {
    const files = await fs.readdir(config.sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(config.sessionsDir, file), "utf-8");
      const interview = JSON.parse(raw) as AiInterview;
      interviews.set(interview.id, interview);
    }
    logger.info({ count: interviews.size }, "Loaded interviews from disk");
  } catch (err) {
    logger.warn({ err }, "Could not load interviews");
  }
}

async function persist(interview: AiInterview): Promise<void> {
  interview.updatedAt = new Date().toISOString();
  interviews.set(interview.id, interview);
  const filePath = path.join(config.sessionsDir, `${interview.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(interview, null, 2));
}

export function getInterview(id: string): AiInterview | undefined {
  return interviews.get(id);
}

export async function createInterview(input: {
  candidateName: string;
  candidateEmail: string;
  role: string;
}): Promise<AiInterview> {
  const now = new Date().toISOString();
  const interview: AiInterview = {
    id: nanoid(12),
    ...input,
    status: "created",
    session_data: defaultSession(),
    createdAt: now,
    updatedAt: now,
  };
  await persist(interview);
  await fs.mkdir(path.join(config.sessionsDir, interview.id, "chunks"), {
    recursive: true,
  });
  return interview;
}

export async function updateInterview(
  id: string,
  patch: Partial<AiInterview>
): Promise<AiInterview | undefined> {
  const existing = interviews.get(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...patch };
  if (patch.session_data) {
    merged.session_data = { ...existing.session_data, ...patch.session_data };
  }
  await persist(merged);
  return merged;
}

export async function listInterviews(): Promise<AiInterview[]> {
  return Array.from(interviews.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function chunkPath(
  sessionId: string,
  questionId: string,
  sequence: number,
  ext = "webm"
): string {
  const padded = String(sequence).padStart(6, "0");
  return path.join(
    config.sessionsDir,
    sessionId,
    "chunks",
    questionId,
    `chunk_${padded}.${ext}`
  );
}
