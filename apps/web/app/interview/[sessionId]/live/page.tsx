'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMediaRecorder } from '../../../../hooks/useMediaRecorder';
import { useWebSocket } from '../../../../hooks/useWebSocket';
import { useProctoring } from '../../../../hooks/useProctoring';
import type { IQuestion, SessionState } from '../../../../../../packages/shared-types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LiveInterviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [question, setQuestion] = useState<IQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [timeRemaining, setTimeRemaining] = useState(180);
  const [isAISpeaking, setIsAISpeaking] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [uploadedChunks, setUploadedChunks] = useState<number[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'speaking' | 'recording' | 'done'>('loading');

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const token = typeof window !== 'undefined' ? localStorage.getItem('interview_token') || '' : '';

  // ── WebSocket ───────────────────────────────────────────────
  const { socket, connected, emitRecordingStarted, emitRecordingStopped, emitNextQuestion } =
    useWebSocket({
      sessionId,
      token,
      onSessionState: (state: SessionState) => {
        if (state.question) setQuestion(state.question);
        setQuestionIndex(state.currentQuestionIndex);
        setTimeRemaining(state.timeRemaining);
        setStatus('ready');
      },
      onNextQuestion: (data) => {
        setQuestion(data.question);
        setQuestionIndex(data.questionIndex);
        setTimeRemaining(data.question.maxDuration);
        setIsAISpeaking(true);
        setChunkCount(0);
        setUploadedChunks([]);
        playQuestionAudio(data.question.audioUrl);
      },
      onInterviewComplete: () => router.push(`/interview/${sessionId}/complete`),
      onError: (msg) => setAlerts((a) => [...a, msg]),
    });

  // ── Media Recorder ──────────────────────────────────────────
  const { startRecording, stopRecording, getStream } = useMediaRecorder({
    interviewId: sessionId,
    questionId: question?.questionId || '',
    onChunkUploaded: (index) => {
      setUploadedChunks((prev) => [...prev, index]);
      setChunkCount((c) => c + 1);
    },
    onError: (err) => {
      setCamError(err);
      setAlerts((a) => [...a, err]);
    },
  });

  // ── Proctoring ──────────────────────────────────────────────
  useProctoring({
    sessionId,
    socket,
    videoRef,
    enabled: isRecording,
    onAlert: (type, msg) => setAlerts((a) => [...a.slice(-4), `⚠ ${msg}`]),
  });

  // ── Camera Setup ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setCamError('Camera access denied');
      }
    })();
  }, []);

  // ── Fetch initial session ───────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/interview/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.interview) {
          const idx = data.interview.session_data.currentQuestionIndex;
          const q = data.interview.questions[idx];
          setQuestion(q);
          setQuestionIndex(idx);
          setTotalQuestions(data.interview.questions.length);
          setTimeRemaining(q?.maxDuration || 180);
          playQuestionAudio(q?.audioUrl);
        }
      });
  }, [sessionId]);

  // ── Timer countdown ─────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) return;
    timerRef.current = setInterval(() => {
      setTimeRemaining((t) => {
        if (t <= 1) {
          handleStopRecording();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  const playQuestionAudio = useCallback((audioUrl?: string) => {
    if (!audioUrl) {
      setTimeout(() => { setIsAISpeaking(false); setStatus('ready'); }, 2000);
      return;
    }
    setIsAISpeaking(true);
    setStatus('speaking');
    const audio = new Audio(audioUrl);
    audio.onended = () => { setIsAISpeaking(false); setStatus('ready'); };
    audio.onerror = () => { setIsAISpeaking(false); setStatus('ready'); };
    audio.play().catch(() => { setIsAISpeaking(false); setStatus('ready'); });
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!question) return;
    await startRecording();
    setIsRecording(true);
    setStatus('recording');
    emitRecordingStarted(question.questionId);
    await fetch(`${API}/api/interview/${sessionId}/start`, { method: 'POST' });
  }, [question, startRecording, emitRecordingStarted, sessionId]);

  const handleStopRecording = useCallback(async () => {
    if (!question) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const count = await stopRecording();
    setIsRecording(false);
    emitRecordingStopped(question.questionId, count);

    // Check if last question
    if (questionIndex + 1 >= totalQuestions) {
      await fetch(`${API}/api/interview/${sessionId}/complete`, { method: 'POST' });
      router.push(`/interview/${sessionId}/complete`);
    } else {
      emitNextQuestion();
    }
  }, [question, stopRecording, emitRecordingStopped, emitNextQuestion, questionIndex, totalQuestions, sessionId, router]);

  const timerPct = Math.round((timeRemaining / (question?.maxDuration || 180)) * 100);
  const timerColor = timerPct > 60 ? '#00ff88' : timerPct > 30 ? '#ffb347' : '#ff3b3b';
  const mins = String(Math.floor(timeRemaining / 60)).padStart(2, '0');
  const secs = String(timeRemaining % 60).padStart(2, '0');

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Timer bar */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ height: '100%', width: `${timerPct}%`, background: timerColor, boxShadow: `0 0 12px ${timerColor}`, transition: 'width 1s linear, background 0.5s' }} />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ background: 'rgba(255,59,59,0.08)', borderBottom: '0.5px solid rgba(255,59,59,0.2)', padding: '10px 24px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff3b3b', boxShadow: '0 0 8px #ff3b3b', display: 'inline-block', animation: 'pulse 1s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#ff3b3b' }}>{alerts[alerts.length - 1]}</span>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 320px' }}>

        {/* LEFT: AI + Question */}
        <div style={{ padding: '36px 40px', display: 'flex', flexDirection: 'column', gap: 28, borderRight: '0.5px solid rgba(255,255,255,0.06)' }}>

          {/* Progress */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>
              QUESTION {questionIndex + 1} OF {totalQuestions}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: totalQuestions }).map((_, i) => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: i < questionIndex ? '#fff' : i === questionIndex ? '#fff' : 'rgba(255,255,255,0.12)',
                  boxShadow: i === questionIndex ? '0 0 10px rgba(255,255,255,0.5)' : 'none',
                  transform: i === questionIndex ? 'scale(1.3)' : 'scale(1)',
                  transition: 'all 0.3s',
                }} />
              ))}
            </div>
          </div>

          {/* Avatar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
              <div style={{
                position: 'absolute', inset: -10, borderRadius: '50%',
                border: `1.5px solid rgba(255,255,255,${isAISpeaking ? 0.25 : 0.08})`,
                animation: 'spin 4s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: -18, borderRadius: '50%',
                border: `0.5px solid rgba(255,255,255,${isAISpeaking ? 0.1 : 0.04})`,
                animation: 'spin 8s linear infinite reverse',
              }} />
              <div style={{
                width: 96, height: 96, borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, #1a1a2e, #000010)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36, filter: 'drop-shadow(0 0 12px rgba(79,158,255,0.5))',
              }}>🤖</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>Aria</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginBottom: 10 }}>AI_INTERVIEWER · GPT-4o</div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: isAISpeaking ? 'rgba(79,158,255,0.1)' : 'rgba(255,255,255,0.04)',
                border: `0.5px solid ${isAISpeaking ? 'rgba(79,158,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 6, padding: '5px 10px', fontSize: 11, fontFamily: 'monospace',
                color: isAISpeaking ? '#4f9eff' : 'rgba(255,255,255,0.4)',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: isAISpeaking ? '#4f9eff' : 'rgba(255,255,255,0.3)', animation: isAISpeaking ? 'pulse 1.5s infinite' : 'none', boxShadow: isAISpeaking ? '0 0 6px #4f9eff' : 'none' }} />
                {isAISpeaking ? 'Speaking...' : status === 'recording' ? 'Listening...' : 'Ready'}
              </div>
            </div>
          </div>

          {/* Question card */}
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: 16, padding: '28px', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)' }} />
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', letterSpacing: 2, marginBottom: 12 }}>CURRENT QUESTION</div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.5, letterSpacing: -0.4 }}>
              {question?.text || 'Loading question...'}
            </div>
          </div>

          {/* Recording row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isRecording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,59,59,0.1)', border: '0.5px solid rgba(255,59,59,0.25)', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontFamily: 'monospace', color: '#ff3b3b' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff3b3b', boxShadow: '0 0 8px #ff3b3b', animation: 'pulse 1s infinite' }} />
                REC
              </div>
            )}
            {isRecording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {[6, 14, 10, 18, 12, 8, 16, 10].map((h, i) => (
                  <div key={i} style={{ width: 3, height: h, borderRadius: 99, background: 'rgba(255,255,255,0.4)', animation: `rwave 0.5s ease-in-out ${i * 0.07}s infinite` }} />
                ))}
              </div>
            )}
            <div style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              {isRecording ? <>Remaining: <span style={{ color: timerColor, fontWeight: 700 }}>{mins}:{secs}</span></> : `Max: ${mins}:${secs}`}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
            {!isRecording ? (
              <button onClick={handleStartRecording} disabled={isAISpeaking || status === 'loading'}
                style={{ flex: 1, padding: 16, borderRadius: 10, background: '#fff', color: '#000', border: 'none', fontSize: 15, fontWeight: 700, cursor: isAISpeaking ? 'not-allowed' : 'pointer', opacity: isAISpeaking ? 0.4 : 1, transition: 'all 0.2s', fontFamily: 'Inter, sans-serif' }}>
                {isAISpeaking ? '🔊 AI Speaking...' : '● Start Recording'}
              </button>
            ) : (
              <>
                <button onClick={handleStopRecording}
                  style={{ flex: 2, padding: 16, borderRadius: 10, background: '#fff', color: '#000', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  Submit Answer →
                </button>
                <button onClick={handleStopRecording}
                  style={{ flex: 1, padding: 16, borderRadius: 10, background: 'rgba(255,59,59,0.1)', color: '#ff3b3b', border: '0.5px solid rgba(255,59,59,0.3)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                  ✕ End
                </button>
              </>
            )}
          </div>

          {camError && (
            <div style={{ background: 'rgba(255,59,59,0.08)', border: '0.5px solid rgba(255,59,59,0.2)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#ff3b3b', display: 'flex', gap: 10, alignItems: 'center' }}>
              📷 {camError} — <button onClick={() => setCamError(null)} style={{ background: 'none', border: 'none', color: '#ff3b3b', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Retry</button>
            </div>
          )}
        </div>

        {/* RIGHT: Candidate cam */}
        <div style={{ background: '#020204', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Camera feed */}
          <div style={{ aspectRatio: '4/3', borderRadius: 14, background: '#050510', border: '0.5px solid rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            {['tl','tr','bl','br'].map((pos) => (
              <div key={pos} style={{
                position: 'absolute', width: 16, height: 16,
                top: pos.includes('t') ? 10 : 'auto', bottom: pos.includes('b') ? 10 : 'auto',
                left: pos.includes('l') ? 10 : 'auto', right: pos.includes('r') ? 10 : 'auto',
                borderColor: 'rgba(255,255,255,0.2)', borderStyle: 'solid', borderRadius: 3,
                borderWidth: pos === 'tl' ? '1.5px 0 0 1.5px' : pos === 'tr' ? '1.5px 1.5px 0 0' : pos === 'bl' ? '0 0 1.5px 1.5px' : '0 1.5px 1.5px 0',
              }} />
            ))}
          </div>

          {/* Chunks */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Chunk Upload</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} style={{
                  aspectRatio: 1, borderRadius: 3,
                  background: uploadedChunks.includes(i) ? '#00ff88' : i === chunkCount ? '#ffb347' : 'rgba(255,255,255,0.06)',
                  boxShadow: uploadedChunks.includes(i) ? '0 0 4px rgba(0,255,136,0.4)' : 'none',
                  animation: i === chunkCount && isRecording ? 'blink 0.5s infinite' : 'none',
                }} />
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>
              {chunkCount}/16 chunks · <span style={{ color: isRecording ? '#4f9eff' : 'rgba(255,255,255,0.2)' }}>
                {isRecording ? 'STREAMING' : 'IDLE'}
              </span>
            </div>
          </div>

          {/* Connection status */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>System</div>
            {[
              { label: 'WebSocket', val: connected ? '● CONNECTED' : '● CONNECTING...', color: connected ? '#00ff88' : '#ffb347' },
              { label: 'Camera', val: camError ? '✕ ERROR' : '● ACTIVE', color: camError ? '#ff3b3b' : '#00ff88' },
              { label: 'Session', val: sessionId.slice(-8).toUpperCase(), color: 'rgba(255,255,255,0.5)' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes rwave { 0%,100%{transform:scaleY(0.4)} 50%{transform:scaleY(1)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
