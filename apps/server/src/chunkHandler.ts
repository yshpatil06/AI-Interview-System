import fs from "fs/promises";
import path from "path";
import type { AiInterview } from "@ai-interview/shared";
import { config } from "./config";
import { logger } from "./logger";
import { chunkPath, updateInterview } from "./store";

export async function saveChunk(params: {
  interview: AiInterview;
  questionId: string;
  sequence: number;
  base64: string;
  mimeType: string;
}): Promise<{ ok: boolean; duplicate: boolean; reason?: string }> {
  const { interview, questionId, sequence, base64, mimeType } = params;
  const received = interview.session_data.receivedChunkSequences;

  if (received.includes(sequence)) {
    logger.debug({ sessionId: interview.id, sequence }, "Duplicate chunk ignored");
    return { ok: true, duplicate: true };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, duplicate: false, reason: "invalid_base64" };
  }

  if (buffer.length < config.chunkMinBytes) {
    logger.warn(
      { sessionId: interview.id, sequence, size: buffer.length },
      "Empty or too-small chunk rejected"
    );
    return { ok: false, duplicate: false, reason: "chunk_too_small" };
  }

  const ext = mimeType.includes("webm") ? "webm" : "wav";
  const filePath = chunkPath(interview.id, questionId, sequence, ext);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(filePath, buffer);
  } catch (err) {
    logger.error({ err, filePath }, "Partial upload / write failure");
    return { ok: false, duplicate: false, reason: "write_failed" };
  }

  const chunkId = path.basename(filePath);
  const answer = interview.session_data.answers.find((a) => a.questionId === questionId);
  if (answer && !answer.chunkIds.includes(chunkId)) {
    answer.chunkIds.push(chunkId);
  }

  const newReceived = [...received, sequence].sort((a, b) => a - b);
  await updateInterview(interview.id, {
    status: "in_progress",
    session_data: {
      ...interview.session_data,
      receivedChunkSequences: newReceived,
      lastChunkSequence: Math.max(interview.session_data.lastChunkSequence, sequence),
      answers: interview.session_data.answers,
    },
  });

  return { ok: true, duplicate: false };
}

export async function getMissingSequences(
  sessionId: string,
  questionId: string,
  maxSequence: number
): Promise<number[]> {
  const dir = path.join(config.sessionsDir, sessionId, "chunks", questionId);
  const missing: number[] = [];
  let existing = new Set<number>();
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      const m = f.match(/chunk_(\d+)\./);
      if (m) existing.add(parseInt(m[1], 10));
    }
  } catch {
    existing = new Set();
  }
  for (let i = 0; i <= maxSequence; i++) {
    if (!existing.has(i)) missing.push(i);
  }
  return missing;
}
