'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function CompletePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const steps = ['Chunk Upload', 'FFmpeg Merge', 'Deepgram Transcription', 'GPT-4o Evaluation', 'Recruiter Notification'];

  useEffect(() => {
    const t = setInterval(() => setStep(s => s < steps.length ? s + 1 : s), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 24, filter: 'drop-shadow(0 0 24px rgba(0,255,136,0.4))' }}>✅</div>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -2, marginBottom: 12 }}>Interview Complete</h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 40, lineHeight: 1.6 }}>
          All 5 questions recorded. Your responses are being processed by our AI pipeline.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 40 }}>
          {[['5/5', '#00ff88', 'Questions'], ['48', '#4f9eff', 'Chunks Sent'], ['0', '#ffb347', 'Flag Events']].map(([n, c, l]) => (
            <div key={l as string} style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '20px 16px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: c as string, letterSpacing: -1, marginBottom: 4 }}>{n}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 20, textAlign: 'left', marginBottom: 32 }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < steps.length - 1 ? '0.5px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: i < step ? 'rgba(0,255,136,0.1)' : i === step ? 'rgba(255,179,71,0.1)' : 'rgba(255,255,255,0.04)', fontSize: 14 }}>
                {i < step ? '✓' : i === step ? '⟳' : '·'}
              </div>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: i < step ? '#00ff88' : i === step ? '#ffb347' : 'rgba(255,255,255,0.3)', animation: i === step ? 'blink 1s infinite' : 'none' }}>
                {i < step ? 'COMPLETE' : i === step ? 'PROCESSING...' : 'QUEUED'}
              </span>
            </div>
          ))}
        </div>

        <button onClick={() => router.push('/')} style={{ padding: '14px 28px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: '#fff', border: '0.5px solid rgba(255,255,255,0.12)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          ← Back to Home
        </button>
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
