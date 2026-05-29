'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [sessionId] = useState(`sess_${Date.now()}`);

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, padding: 32 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 3, marginBottom: 16 }}>AI VIDEO INTERVIEW PLATFORM</div>
        <h1 style={{ fontSize: 56, fontWeight: 800, letterSpacing: -3, margin: 0 }}>Interview<span style={{ color: 'rgba(255,255,255,0.3)' }}>AI</span></h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>Automated first-round screening powered by GPT-4o</p>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => router.push(`/interview/${sessionId}/hardware-check`)}
          style={{ padding: '16px 32px', borderRadius: 10, background: '#fff', color: '#000', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          🎤 Start as Candidate
        </button>
        <button onClick={() => router.push('/dashboard/recruiter')}
          style={{ padding: '16px 32px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', border: '0.5px solid rgba(255,255,255,0.15)', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
          📊 Recruiter Dashboard
        </button>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
        Session: {sessionId}
      </div>
    </div>
  );
}
