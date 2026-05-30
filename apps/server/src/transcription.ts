import { config } from "./config";
import { logger } from "./logger";

/** Simulated Deepgram path — uses API when key present, else mock STT for demo */
export async function transcribeMerged(
  buffer: Buffer,
  sessionId: string,
  questionId: string
): Promise<string> {
  if (config.deepgramApiKey) {
    try {
      const res = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${config.deepgramApiKey}`,
            "Content-Type": "audio/webm",
          },
          body: new Uint8Array(buffer),
        }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
        };
        const text =
          json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
        if (text) return text;
      }
      logger.warn({ sessionId, questionId }, "Deepgram returned non-ok; using fallback");
    } catch (err) {
      logger.error({ err }, "Deepgram request failed");
    }
  }

  const kb = Math.round(buffer.length / 1024);
  return `[Demo transcript — ${kb}KB merged for ${questionId}] Candidate provided a spoken response. Configure DEEPGRAM_API_KEY for real speech-to-text.`;
}
