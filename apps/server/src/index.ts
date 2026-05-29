import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
});

// Simple socket setup
io.of('/interview').on('connection', (socket) => {
  console.log('[Socket] Candidate connected:', socket.id);

  socket.on('join_session', async ({ sessionId }: { sessionId: string }) => {
    socket.join(`session:${sessionId}`);
    console.log('[Socket] Joined session:', sessionId);

    // Mock session state
    socket.emit('session_state', {
      currentQuestionIndex: 0,
      timeRemaining: 180,
      status: 'in_progress',
      question: {
        questionId: 'q_001',
        text: 'Tell me about yourself and your experience with system design.',
        audioUrl: '',
        order: 0,
        maxDuration: 180,
      },
    });
  });

  socket.on('proctor_event', (event) => {
    console.log('[Socket] Proctor event:', event.type);
    io.of('/recruiter').emit('proctor_alert', event);
  });

  socket.on('recording_started', ({ questionId }) => {
    console.log('[Socket] Recording started for:', questionId);
  });

  socket.on('recording_stopped', ({ questionId, chunkCount }) => {
    console.log(`[Socket] Recording stopped: ${questionId}, ${chunkCount} chunks`);
    socket.emit('finalize_queued', { questionId });
  });

  socket.on('next_question', async () => {
    const questions = [
      'Tell me about yourself and your experience with system design.',
      'Explain how you would design a real-time video streaming system for 10,000 users.',
      'How do you handle failure and recovery in distributed systems?',
      'Describe a challenging technical problem you solved recently.',
      'Where do you see yourself in 5 years technically?',
    ];

    const idx = Math.floor(Math.random() * questions.length);
    socket.emit('next_question', {
      question: { questionId: `q_00${idx}`, text: questions[idx], audioUrl: '', order: idx, maxDuration: 180 },
      questionIndex: idx,
      total: 5,
    });
  });

  socket.on('disconnect', () => console.log('[Socket] Disconnected:', socket.id));
});

io.of('/recruiter').on('connection', (socket) => {
  console.log('[Socket/Recruiter] Connected:', socket.id);
  socket.on('watch_interview', ({ interviewId }) => {
    socket.join(`session:${interviewId}`);
  });
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Mock interview session endpoint
app.post('/api/interview/create', async (req, res) => {
  const { candidateId, jobId, recruiterId } = req.body;
  const sessionId = `sess_${Date.now()}`;
  res.json({ success: true, interviewId: sessionId, questions: [] });
});

app.get('/api/interview/:id', (req, res) => {
  res.json({
    success: true,
    interview: {
      _id: req.params.id,
      status: 'in_progress',
      session_data: { currentQuestionIndex: 0, startedAt: new Date(), reconnectCount: 0 },
      questions: [
        { questionId: 'q_001', text: 'Tell me about yourself and your experience.', audioUrl: '', order: 0, maxDuration: 180 },
        { questionId: 'q_002', text: 'Design a real-time video streaming system for 10K users.', audioUrl: '', order: 1, maxDuration: 180 },
        { questionId: 'q_003', text: 'How do you handle failures in distributed systems?', audioUrl: '', order: 2, maxDuration: 180 },
        { questionId: 'q_004', text: 'Describe a challenging technical problem you solved.', audioUrl: '', order: 3, maxDuration: 180 },
        { questionId: 'q_005', text: 'Where do you see yourself technically in 5 years?', audioUrl: '', order: 4, maxDuration: 180 },
      ],
      responses: [],
      proctoring: { tabSwitchCount: 0, faceAbsenceEvents: [], suspiciousScore: 0, flags: [] },
      evaluation: { overallScore: 0, technicalScore: 0, communicationScore: 0, summary: '', recommendation: 'maybe' },
    },
  });
});

app.post('/api/interview/:id/start', (req, res) => {
  console.log('[API] Interview started:', req.params.id);
  res.json({ success: true, status: 'in_progress' });
});

app.post('/api/interview/:id/complete', (req, res) => {
  console.log('[API] Interview completed:', req.params.id);
  res.json({ success: true, message: 'Processing started' });
});

// Chunk upload (mock - no S3 needed locally)
app.post('/api/interview/chunk/upload', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const { interviewId, questionId, chunkIndex } = req.query;
  console.log(`[Chunk] Received chunk ${chunkIndex} for ${interviewId}/${questionId}`);
  res.json({ success: true, s3Key: `interviews/${interviewId}/${questionId}/chunk_${chunkIndex}.webm`, skipped: false });
});

app.post('/api/interview/chunk/finalize', (req, res) => {
  console.log('[Chunk] Finalize:', req.body);
  res.json({ success: true, message: 'Merge job queued' });
});

// Recruiter endpoints
app.get('/api/recruiter/interviews', (req, res) => {
  res.json({
    success: true,
    total: 5,
    page: 1,
    pages: 1,
    interviews: [
      { _id: 'i1', candidateId: { name: 'Rahul Sharma', email: 'rahul@gmail.com' }, status: 'completed', evaluation: { overallScore: 87, recommendation: 'strong_yes' }, proctoring: { suspiciousScore: 4 }, createdAt: new Date() },
      { _id: 'i2', candidateId: { name: 'Priya Mehta', email: 'priya@outlook.com' }, status: 'completed', evaluation: { overallScore: 62, recommendation: 'maybe' }, proctoring: { suspiciousScore: 71 }, createdAt: new Date() },
      { _id: 'i3', candidateId: { name: 'Arjun Patel', email: 'arjun@yahoo.com' }, status: 'processing', evaluation: { overallScore: 79, recommendation: 'yes' }, proctoring: { suspiciousScore: 12 }, createdAt: new Date() },
    ],
  });
});

// Connect to MongoDB if available, else run without DB
const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/interviewai';
mongoose.connect(MONGO)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(() => console.log('⚠️  MongoDB not available — running in mock mode'));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n🚀 InterviewAI Server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`❤️  Health: http://localhost:${PORT}/health\n`);
});

export { io };
