'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SessionState } from '../../../packages/shared-types';

interface UseWebSocketOptions {
  sessionId: string;
  token: string;
  wsUrl?: string;
  onSessionState?: (state: SessionState) => void;
  onNextQuestion?: (data: any) => void;
  onInterviewComplete?: () => void;
  onProctorAlert?: (data: any) => void;
  onError?: (msg: string) => void;
}

export function useWebSocket({
  sessionId,
  token,
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000',
  onSessionState,
  onNextQuestion,
  onInterviewComplete,
  onProctorAlert,
  onError,
}: UseWebSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  useEffect(() => {
    const socket = io(`${wsUrl}/interview`, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);
      setConnected(true);
      // Re-join session and re-fetch state on every reconnect
      socket.emit('join_session', { sessionId });
    });

    socket.on('disconnect', (reason) => {
      console.warn('[WS] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('reconnect', (attemptNumber: number) => {
      console.log('[WS] Reconnected after', attemptNumber, 'attempts');
      setReconnectCount((c) => c + 1);
    });

    socket.on('reconnect_error', (err: Error) => {
      console.error('[WS] Reconnect error:', err.message);
    });

    socket.on('session_state', (state: SessionState) => {
      onSessionState?.(state);
    });

    socket.on('next_question', (data: any) => {
      onNextQuestion?.(data);
    });

    socket.on('interview_complete', () => {
      onInterviewComplete?.();
    });

    socket.on('proctor_alert', (data: any) => {
      onProctorAlert?.(data);
    });

    socket.on('error', ({ message }: { message: string }) => {
      onError?.(message);
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId, token, wsUrl]);

  const emitProctorEvent = useCallback((type: string, data?: Record<string, unknown>) => {
    socketRef.current?.emit('proctor_event', { type, sessionId, timestamp: new Date(), data });
  }, [sessionId]);

  const emitRecordingStarted = useCallback((questionId: string) => {
    socketRef.current?.emit('recording_started', { questionId });
  }, []);

  const emitRecordingStopped = useCallback((questionId: string, chunkCount: number) => {
    socketRef.current?.emit('recording_stopped', { questionId, chunkCount });
  }, []);

  const emitNextQuestion = useCallback(() => {
    socketRef.current?.emit('next_question');
  }, []);

  return {
    socket: socketRef.current,
    connected,
    reconnectCount,
    emitProctorEvent,
    emitRecordingStarted,
    emitRecordingStopped,
    emitNextQuestion,
  };
}
