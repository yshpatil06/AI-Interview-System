import path from "path";

const root = path.resolve(__dirname, "../../../..");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  wsPath: "/ws/interview",
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  sessionsDir: process.env.SESSIONS_DIR ?? path.join(root, "data", "sessions"),
  chunkMinBytes: Number(process.env.CHUNK_MIN_BYTES ?? 100),
  maxChunkRetries: 3,
  mergeDelayMs: Number(process.env.MERGE_DELAY_MS ?? 2000),
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? "",
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:3000",
};
