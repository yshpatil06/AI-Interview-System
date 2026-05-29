'use client';
import { useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';

interface UseProctoringOptions {
  sessionId: string;
  socket: Socket | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled?: boolean;
  onAlert?: (type: string, message: string) => void;
}

export function useProctoring({
  sessionId,
  socket,
  videoRef,
  enabled = true,
  onAlert,
}: UseProctoringOptions) {
  const faceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceAbsentSinceRef = useRef<number | null>(null);
  const tabSwitchCountRef = useRef(0);

  const emitProctorEvent = useCallback(
    (type: string, data?: Record<string, unknown>) => {
      if (!socket || !enabled) return;
      socket.emit('proctor_event', { type, sessionId, timestamp: new Date(), data });
    },
    [socket, sessionId, enabled]
  );

  // ── Tab Switch Detection ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        tabSwitchCountRef.current++;
        emitProctorEvent('TAB_SWITCH', { count: tabSwitchCountRef.current });
        onAlert?.('TAB_SWITCH', `Tab switch #${tabSwitchCountRef.current} detected`);
        console.warn('[Proctoring] Tab switch detected');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, emitProctorEvent, onAlert]);

  // ── Window Blur Detection ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const handleBlur = () => {
      emitProctorEvent('TAB_SWITCH', { source: 'window_blur' });
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [enabled, emitProctorEvent]);

  // ── Face Detection via Canvas ─────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const detectFace = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      try {
        // Create canvas snapshot
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, 160, 120);

        // Get pixel data and check for skin-tone pixels (simple heuristic)
        const imageData = ctx.getImageData(0, 0, 160, 120);
        const { data } = imageData;
        let skinPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // Simple skin tone detection heuristic
          if (r > 60 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && Math.abs(r - b) > 15) {
            skinPixels++;
          }
        }

        const totalPixels = 160 * 120;
        const skinRatio = skinPixels / totalPixels;
        const faceDetected = skinRatio > 0.03; // 3% threshold

        if (!faceDetected) {
          if (!faceAbsentSinceRef.current) {
            faceAbsentSinceRef.current = Date.now();
            emitProctorEvent('FACE_ABSENT');
            onAlert?.('FACE_ABSENT', 'Face not detected in frame');
          }
        } else {
          if (faceAbsentSinceRef.current) {
            const duration = Date.now() - faceAbsentSinceRef.current;
            emitProctorEvent('FACE_PRESENT', { duration });
            faceAbsentSinceRef.current = null;
          }
        }
      } catch (err) {
        // Face detection is best-effort; never block interview
        console.warn('[Proctoring] Face detection error:', err);
      }
    };

    faceIntervalRef.current = setInterval(detectFace, 3000);
    return () => {
      if (faceIntervalRef.current) clearInterval(faceIntervalRef.current);
    };
  }, [enabled, videoRef, emitProctorEvent, onAlert]);

  // ── Copy/Paste Prevention ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const block = (e: ClipboardEvent) => {
      e.preventDefault();
      emitProctorEvent('COPY_PASTE_ATTEMPT');
    };
    document.addEventListener('copy', block);
    document.addEventListener('paste', block);
    return () => {
      document.removeEventListener('copy', block);
      document.removeEventListener('paste', block);
    };
  }, [enabled, emitProctorEvent]);

  return { tabSwitchCount: tabSwitchCountRef.current };
}
