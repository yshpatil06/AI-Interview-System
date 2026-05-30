import type { WsClientMessage, WsServerMessage } from "@ai-interview/shared";
import { wsUrl } from "./api";

type Handlers = {
  onMessage?: (msg: WsServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export class InterviewSocket {
  private ws: WebSocket | null = null;
  private retries = 0;
  private maxRetries = 8;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private queue: WsClientMessage[] = [];

  constructor(
    private sessionId: string,
    private resumeToken: string,
    private handlers: Handlers
  ) {}

  connect(): void {
    this.intentionalClose = false;
    this.ws = new WebSocket(wsUrl());

    this.ws.onopen = () => {
      this.retries = 0;
      this.auth();
      this.flushQueue();
      this.handlers.onOpen?.();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsServerMessage;
        this.handlers.onMessage?.(msg);
      } catch {
        /* ignore */
      }
    };

    this.ws.onclose = () => {
      this.handlers.onClose?.();
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private auth(): void {
    this.send({ type: "auth", sessionId: this.sessionId, resumeToken: this.resumeToken });
  }

  private scheduleReconnect(): void {
    if (this.retries >= this.maxRetries) return;
    const delay = Math.min(1000 * 2 ** this.retries, 15000);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!;
      this.send(msg);
    }
  }

  send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  sendChunk(questionId: string, sequence: number, blob: Blob): void {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1] ?? "";
      this.send({
        type: "chunk",
        questionId,
        sequence,
        mimeType: blob.type || "video/webm",
        data: base64,
      });
    };
    reader.readAsDataURL(blob);
  }

  requestMissingChunks(questionId: string): void {
    this.send({ type: "chunk_ack_request", questionId });
  }

  proctor(
    event: "tab_switch" | "face_absent" | "window_blur" | "copy_paste" | "devtools_open",
    metadata?: Record<string, unknown>
  ): void {
    this.send({ type: "proctor", event, metadata });
  }

  completeQuestion(questionId: string): void {
    this.send({ type: "question_complete", questionId });
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
