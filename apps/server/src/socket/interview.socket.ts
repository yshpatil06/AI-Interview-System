import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { AiInterview } from '../models/AiInterview.model';
import type { ProctorEvent, SessionState } from '../../../packages/shared-types';

interface AuthSocket extends Socket {
  candidateId?: string;
  sessionId?: string;
}

export function registerInterviewSocket(io: Server): void {
  const interviewNS = io.of('/interview');

  // JWT middleware
  interviewNS.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Missing auth token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
      socket.candidateId = decoded.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  interviewNS.on('connection', (socket: AuthSocket) => {
    console.log(`[Socket/Interview] Connected: ${socket.id}`);

    // ── JOIN SESSION ──────────────────────────────────────────
    socket.on('join_session', async ({ sessionId }: { sessionId: string }) => {
      try {
        const interview = await AiInterview.findById(sessionId);
        if (!interview) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        socket.sessionId = sessionId;
        socket.join(`session:${sessionId}`);
        socket.join(`recruiter:${interview.recruiterId}`);

        // Update reconnect count
        await AiInterview.findByIdAndUpdate(sessionId, {
          $inc: { 'session_data.reconnectCount': 1 },
          $set: { 'session_data.lastActiveAt': new Date() },
        });

        const currentQ = interview.questions[interview.session_data.currentQuestionIndex];
        const state: SessionState = {
          currentQuestionIndex: interview.session_data.currentQuestionIndex,
          timeRemaining: currentQ?.maxDuration || 180,
          status: interview.status,
          question: currentQ || null,
        };

        socket.emit('session_state', state);
        console.log(`[Socket/Interview] ${socket.candidateId} joined session ${sessionId}`);
      } catch (err) {
        console.error('[Socket/Interview] join_session error:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // ── PROCTOR EVENTS ────────────────────────────────────────
    socket.on('proctor_event', async (event: ProctorEvent) => {
      if (!socket.sessionId) return;

      try {
        const { type, timestamp, data } = event;

        if (type === 'TAB_SWITCH') {
          await AiInterview.findByIdAndUpdate(socket.sessionId, {
            $inc: { 'proctoring.tabSwitchCount': 1 },
            $push: { 'proctoring.flags': `TAB_SWITCH at ${new Date(timestamp).toISOString()}` },
          });
        } else if (type === 'FACE_ABSENT') {
          await AiInterview.findByIdAndUpdate(socket.sessionId, {
            $push: {
              'proctoring.faceAbsenceEvents': {
                timestamp: new Date(timestamp),
                duration: (data as any)?.duration || 0,
              },
            },
          });
        }

        // Broadcast to recruiter room for live monitoring
        interviewNS.to(`recruiter:${socket.sessionId}`).emit('proctor_alert', {
          sessionId: socket.sessionId,
          type,
          timestamp,
          candidateId: socket.candidateId,
        });
      } catch (err) {
        console.error('[Socket/Interview] proctor_event error:', err);
      }
    });

    // ── RECORDING EVENTS ──────────────────────────────────────
    socket.on('recording_started', ({ questionId }: { questionId: string }) => {
      if (!socket.sessionId) return;
      console.log(`[Socket/Interview] Recording started: ${socket.sessionId}/${questionId}`);
      socket.to(`session:${socket.sessionId}`).emit('recording_started', { questionId });
    });

    socket.on(
      'recording_stopped',
      async ({ questionId, chunkCount }: { questionId: string; chunkCount: number }) => {
        if (!socket.sessionId) return;
        console.log(`[Socket/Interview] Recording stopped: ${questionId}, ${chunkCount} chunks`);

        // Trigger finalize via HTTP or import service directly
        try {
          const { finalizeQuestion } = await import('../services/chunk.service');
          await finalizeQuestion({ interviewId: socket.sessionId, questionId });
          socket.emit('finalize_queued', { questionId });
        } catch (err) {
          console.error('[Socket] finalizeQuestion error:', err);
          socket.emit('error', { message: 'Failed to queue finalization' });
        }
      }
    );

    // ── NEXT QUESTION ─────────────────────────────────────────
    socket.on('next_question', async () => {
      if (!socket.sessionId) return;
      const interview = await AiInterview.findById(socket.sessionId);
      if (!interview) return;

      const nextIndex = interview.session_data.currentQuestionIndex + 1;

      if (nextIndex >= interview.questions.length) {
        await AiInterview.findByIdAndUpdate(socket.sessionId, {
          $set: { status: 'processing' },
        });
        socket.emit('interview_complete');
        return;
      }

      await AiInterview.findByIdAndUpdate(socket.sessionId, {
        $set: { 'session_data.currentQuestionIndex': nextIndex },
      });

      const nextQ = interview.questions[nextIndex];
      socket.emit('next_question', {
        question: nextQ,
        questionIndex: nextIndex,
        total: interview.questions.length,
      });
    });

    // ── DISCONNECT ────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket/Interview] Disconnected: ${socket.id}, reason: ${reason}`);
      if (socket.sessionId) {
        await AiInterview.findByIdAndUpdate(socket.sessionId, {
          $set: { 'session_data.lastActiveAt': new Date() },
          $push: { 'proctoring.flags': `DISCONNECT at ${new Date().toISOString()}: ${reason}` },
        });
      }
    });
  });

  // ── RECRUITER NAMESPACE ───────────────────────────────────────
  const recruiterNS = io.of('/recruiter');

  recruiterNS.on('connection', (socket) => {
    socket.on('watch_interview', ({ interviewId }: { interviewId: string }) => {
      socket.join(`session:${interviewId}`);
      console.log(`[Socket/Recruiter] Watching: ${interviewId}`);
    });

    socket.on('list_active', async () => {
      const active = await AiInterview.find({ status: 'in_progress' })
        .populate('candidateId', 'name email')
        .select('candidateId status session_data proctoring')
        .lean();
      socket.emit('active_interviews', active);
    });
  });
}
