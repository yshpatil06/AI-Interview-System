import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { DEFAULT_QUESTIONS } from "@ai-interview/shared";
import { config } from "./config";
import {
  createInterview,
  getInterview,
  listInterviews,
  updateInterview,
} from "./store";
import { enqueueMerge } from "./mergeQueue";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-interview-api" });
});

router.get("/questions", (_req, res) => {
  res.json({ questions: DEFAULT_QUESTIONS });
});

const createSchema = z.object({
  candidateName: z.string().min(1),
  candidateEmail: z.string().email(),
  role: z.string().min(1),
});

router.post("/interviews", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const interview = await createInterview(parsed.data);
  res.status(201).json({
    interview,
    joinUrl: `${config.publicWebUrl}/interview/${interview.id}?token=${interview.session_data.resumeToken}`,
  });
});

router.get("/interviews", async (_req, res) => {
  const list = await listInterviews();
  res.json({ interviews: list });
});

router.get("/interviews/:id", async (req, res) => {
  const interview = getInterview(req.params.id);
  if (!interview) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ interview });
});

router.patch("/interviews/:id/hardware", async (req, res) => {
  const interview = getInterview(req.params.id);
  if (!interview) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const updated = await updateInterview(req.params.id, {
    status: "hardware_check",
    session_data: { ...interview.session_data, hardwareVerified: true },
  });
  res.json({ interview: updated });
});

router.post("/interviews/:id/chunk", async (req, res) => {
  const { questionId, sequence, data, mimeType } = req.body as {
    questionId: string;
    sequence: number;
    data: string;
    mimeType: string;
  };
  const interview = getInterview(req.params.id);
  if (!interview) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { saveChunk } = await import("./chunkHandler");
  const result = await saveChunk({
    interview,
    questionId,
    sequence,
    base64: data,
    mimeType: mimeType ?? "video/webm",
  });
  res.status(result.ok ? 200 : 400).json(result);
});

router.get("/interviews/:id/media/:questionId", async (req, res) => {
  const filePath = path.join(
    config.sessionsDir,
    req.params.id,
    "merged",
    `${req.params.questionId}.webm`
  );
  try {
    const stat = await fs.stat(filePath);
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Length", stat.size);
    const data = await fs.readFile(filePath);
    res.send(data);
  } catch {
    res.status(404).json({ error: "media_not_ready" });
  }
});

router.post("/interviews/:id/merge/:questionId", async (req, res) => {
  enqueueMerge(req.params.id, req.params.questionId);
  res.json({ queued: true });
});
