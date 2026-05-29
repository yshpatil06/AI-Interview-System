'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function RecruiterDashboard() {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/recruiter/interviews`)
      .then(r => r.json())
      .then(d => { setInterviews(d.interviews || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const scoreColor = (s: number) => s >= 75 ? '#00ff88' : s >= 50 ? '#ffb347' : '#ff3b3b';
  const recColor: Record<string, string> = { strong_yes: '#00ff88', yes: '#4f9eff', maybe: '#ffb347', no: '#ff3b3b' };

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif', padding: 32 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 2, marginBottom: 8 }}>RECRUITER DASHBOARD</div>
            <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, margin: 0 }}>Candidate Results</h1>
          </div>
          <a href="/" style={{ padding: '10px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>← Home</a>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', padding: 60 }}>LOADING...</div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
                  {['Candidate', 'Score', 'Recommendation', 'Suspicious Score', 'Status'].map(h => (
                    <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', letterSpacing: 1.5, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interviews.map((iv, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.03)' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{iv.candidateId?.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginTop: 2 }}>{iv.candidateId?.email}</div>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <span style={{ padding: '4px 12px', borderRadius: 6, fontSize: 14, fontWeight: 700, fontFamily: 'monospace', background: `${scoreColor(iv.evaluation?.overallScore)}15`, color: scoreColor(iv.evaluation?.overallScore), border: `0.5px solid ${scoreColor(iv.evaluation?.overallScore)}30` }}>
                        {iv.evaluation?.overallScore}
                      </span>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'monospace', background: `${recColor[iv.evaluation?.recommendation] || '#fff'}15`, color: recColor[iv.evaluation?.recommendation] || '#fff', border: `0.5px solid ${recColor[iv.evaluation?.recommendation] || '#fff'}30`, textTransform: 'uppercase' }}>
                        {iv.evaluation?.recommendation?.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <span style={{ fontSize: 13, fontFamily: 'monospace', color: iv.proctoring?.suspiciousScore > 30 ? '#ff3b3b' : '#00ff88' }}>
                        {iv.proctoring?.suspiciousScore > 30 ? '⚠ ' : '✓ '}{iv.proctoring?.suspiciousScore}/100
                      </span>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: iv.status === 'completed' ? '#00ff88' : '#ffb347' }}>
                        {iv.status === 'completed' ? '● DONE' : '⟳ PROCESSING'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
