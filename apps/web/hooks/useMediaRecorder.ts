'use client';
import { useRef, useCallback, useEffect } from 'react';

const DB_NAME = 'interviewai-pending-chunks';
const STORE_NAME = 'chunks';
const CHUNK_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;

interface UseMediaRecorderOptions {
  interviewId: string;
  questionId: string;
  apiUrl?: string;
  onChunkUploaded?: (index: number, s3Key: string) => void;
  onError?: (err: string) => void;
}

// ── IndexedDB helpers ────────────────────────────────────────
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveChunkIDB(key: string, blob: Blob, meta: object): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, blob, meta, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteChunkIDB(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
  });
}

async function getAllPendingChunks(): Promise<Array<{ key: string; blob: Blob; meta: any }>> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

// ── Upload with retry + exponential backoff ──────────────────
async function uploadChunkWithRetry(
  blob: Blob,
  meta: { interviewId: string; questionId: string; chunkIndex: number },
  apiUrl: string,
  retries = MAX_RETRIES
): Promise<{ success: boolean; s3Key?: string }> {
  const idbKey = `pending_chunk_${meta.interviewId}_${meta.questionId}_${meta.chunkIndex}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const formData = new FormData();
      formData.append('audioBlob', blob, `chunk_${meta.chunkIndex}.webm`);
      formData.append('interviewId', meta.interviewId);
      formData.append('questionId', meta.questionId);
      formData.append('chunkIndex', String(meta.chunkIndex));

      const res = await fetch(`${apiUrl}/api/interview/chunk/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Clean up IDB on success
      await deleteChunkIDB(idbKey);
      return { success: true, s3Key: data.s3Key };
    } catch (err) {
      console.warn(`[useMediaRecorder] Upload attempt ${attempt + 1} failed:`, err);

      // Save to IndexedDB for recovery
      await saveChunkIDB(idbKey, blob, meta);

      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return { success: false };
}

// ── Main Hook ─────────────────────────────────────────────────
export function useMediaRecorder({
  interviewId,
  questionId,
  apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  onChunkUploaded,
  onError,
}: UseMediaRecorderOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const isRecordingRef = useRef(false);

  // Drain pending IDB chunks on mount (recovery after disconnect)
  useEffect(() => {
    (async () => {
      const pending = await getAllPendingChunks();
      const mine = pending.filter(
        (c) => c.meta?.interviewId === interviewId && c.meta?.questionId === questionId
      );
      if (mine.length > 0) {
        console.log(`[useMediaRecorder] Draining ${mine.length} pending chunks from IDB...`);
        for (const item of mine) {
          await uploadChunkWithRetry(item.blob, item.meta, apiUrl);
        }
      }
    })();
  }, [interviewId, questionId, apiUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      chunkIndexRef.current = 0;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 1000) {
          const index = chunkIndexRef.current++;
          const result = await uploadChunkWithRetry(
            e.data,
            { interviewId, questionId, chunkIndex: index },
            apiUrl
          );
          if (result.success && result.s3Key) {
            onChunkUploaded?.(index, result.s3Key);
          } else {
            onError?.(`Chunk ${index} upload failed after retries`);
          }
        }
      };

      recorder.onerror = (e) => {
        console.error('[useMediaRecorder] Recorder error:', e);
        onError?.('MediaRecorder error');
      };

      // Handle camera/mic disconnect
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          console.warn('[useMediaRecorder] Track ended:', track.kind);
          onError?.(`${track.kind} disconnected`);
        };
      });

      recorder.start(CHUNK_INTERVAL_MS); // timeslice passed here
      isRecordingRef.current = true;
      console.log('[useMediaRecorder] Recording started');
      return stream;
    } catch (err: any) {
      onError?.(err.message || 'Failed to start recording');
      throw err;
    }
  }, [interviewId, questionId, apiUrl, onChunkUploaded, onError]);

  const stopRecording = useCallback((): Promise<number> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(chunkIndexRef.current);
        return;
      }
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        isRecordingRef.current = false;
        resolve(chunkIndexRef.current);
      };
      recorder.stop();
    });
  }, []);

  const getStream = useCallback(() => streamRef.current, []);
  const isRecording = useCallback(() => isRecordingRef.current, []);

  return { startRecording, stopRecording, getStream, isRecording };
}
