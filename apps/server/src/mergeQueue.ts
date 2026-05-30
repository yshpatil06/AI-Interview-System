import fs from "fs/promises";
import path from "path";
import type { AiInterview } from "@ai-interview/shared";
import { config } from "./config";
import { logger } from "./logger";
import { getInterview, updateInterview } from "./store";
import { transcribeMerged } from "./transcription";

const queue: string[] = [];
let processing = false;

export function enqueueMerge(sessionId: string, questionId: string): void {
  const key = `${sessionId}:${questionId}`;
  if (!queue.includes(key)) queue.push(key);
  void drain();
}

async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const key = queue.shift()!;
    const [sessionId, questionId] = key.split(":");
    try {
      await mergeChunks(sessionId, questionId);
    } catch (err) {
      logger.error({ err, sessionId, questionId }, "Merge failed");
    }
  }
  processing = false;
}

async function mergeChunks(sessionId: string, questionId: string): Promise<void> {
  const interview = getInterview(sessionId);
  if (!interview) return;

  const answer = interview.session_data.answers.find((a) => a.questionId === questionId);
  if (!answer) return;

  answer.mergeStatus = "merging";
  await updateInterview(sessionId, {
    status: "processing",
    session_data: interview.session_data,
  });

  const chunkDir = path.join(config.sessionsDir, sessionId, "chunks", questionId);
  let files: string[] = [];
  try {
    files = (await fs.readdir(chunkDir))
      .filter((f) => f.startsWith("chunk_"))
      .sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    answer.mergeStatus = "failed";
    await updateInterview(sessionId, { session_data: interview.session_data });
    return;
  }

  const buffers: Buffer[] = [];
  for (const file of files) {
    const data = await fs.readFile(path.join(chunkDir, file));
    if (data.length >= config.chunkMinBytes) buffers.push(data);
  }

  const merged = Buffer.concat(buffers);
  const outDir = path.join(config.sessionsDir, sessionId, "merged");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${questionId}.webm`);
  await fs.writeFile(outPath, merged);

  const transcript = await transcribeMerged(merged, sessionId, questionId);
  answer.transcript = transcript;
  answer.mergeStatus = "done";
  answer.endedAt = new Date().toISOString();

  const refreshed = getInterview(sessionId)!;
  const transcripts = refreshed.session_data.answers
    .map((a) => a.transcript)
    .filter(Boolean)
    .join("\n\n");

  await updateInterview(sessionId, {
    session_data: refreshed.session_data,
    mergedMediaPath: outPath,
    fullTranscript: transcripts,
  });

  logger.info({ sessionId, questionId, chunks: files.length }, "Merge complete");
}

export async function finalizeInterview(sessionId: string): Promise<void> {
  const interview = getInterview(sessionId);
  if (!interview) return;

  for (const answer of interview.session_data.answers) {
    enqueueMerge(sessionId, answer.questionId);
  }

  await new Promise((r) => setTimeout(r, config.mergeDelayMs + 500));

  const updated = getInterview(sessionId);
  if (!updated) return;

  const score = computeScore(updated);
  await updateInterview(sessionId, {
    status: "completed",
    aiScore: score,
    aiSummary: buildSummary(updated),
  });
}

function computeScore(interview: AiInterview): number {
  const base = 70;
  const penalty = Math.min(30, interview.session_data.suspiciousEvents.length * 3);
  const transcriptBonus =
    (interview.fullTranscript?.split(/\s+/).length ?? 0) > 50 ? 10 : 0;
  return Math.max(0, Math.min(100, base - penalty + transcriptBonus));
}

function buildSummary(interview: AiInterview): string {
  const events = interview.session_data.suspiciousEvents.length;
  return `Candidate completed ${interview.session_data.answers.filter((a) => a.mergeStatus === "done").length} responses. ${events} proctoring flag(s). Review transcript and playback before advancing.`;
}
