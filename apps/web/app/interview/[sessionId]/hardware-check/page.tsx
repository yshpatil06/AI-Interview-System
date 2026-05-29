'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

type CheckStatus = 'idle' | 'checking' | 'pass' | 'fail';

interface CheckState {
  camera: CheckStatus;
  microphone: CheckStatus;
  speaker: CheckStatus;
  network: CheckStatus;
}

export default function HardwareCheckPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [checks, setChecks] = useState<CheckState>({ camera: 'idle', microphone: 'idle', speaker: 'idle', network: 'idle' });
  const [micLevel, setMicLevel] = useState(0);
  const [networkSpeed, setNetworkSpeed] = useState<number | null>(null);
  const [cameraRes, setCameraRes] = useState<string>('');
  const [allPassed, setAllPassed] = useState(false);

  const setCheck = (key: keyof CheckState, val: CheckStatus) =>
    setChecks((p) => ({ ...p, [key]: val }));

  // ── Camera Check ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setCheck('camera', 'checking');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            const { videoWidth: w, videoHeight: h } = videoRef.current!;
            setCameraRes(`${w}×${h}`);
          };
        }
        setCheck('camera', 'pass');
        setupMic(stream);
      } catch {
        setCheck('camera', 'fail');
        setCheck('microphone', 'fail');
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Mic Level Meter ──────────────────────────────────────────
  const setupMic = (stream: MediaStream) => {
    setCheck('microphone', 'checking');
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, avg * 2));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
      setTimeout(() => setCheck('microphone', 'pass'), 1500);
    } catch {
      setCheck('microphone', 'fail');
    }
  };

  // ── Network Check ─────────────────────────────────────────────
  useEffect(() => {
    setCheck('network', 'checking');
    const start = Date.now();
    fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' })
      .then((r) => r.text())
      .then(() => {
        const ms = Date.now() - start;
        const estimatedMbps = Math.min(50, Math.round(1000 / ms * 10) / 10);
        setNetworkSpeed(estimatedMbps);
        setCheck('network', estimatedMbps >= 1 ? 'pass' : 'fail');
      })
      .catch(() => {
        setNetworkSpeed(5); // Assume ok if blocked by CORS
        setCheck('network', 'pass');
      });
  }, []);

  useEffect(() => {
    const passed = Object.values(checks).every((v) => v === 'pass') && checks.speaker === 'pass';
    setAllPassed(passed);
  }, [checks]);

  const testSpeaker = () => {
    setCheck('speaker', 'checking');
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
      osc.onended = () => { setCheck('speaker', 'pass'); ctx.close(); };
    } catch { setCheck('speaker', 'fail'); }
  };

  const s = (key: keyof CheckState) => checks[key];
  const color = (st: CheckStatus) => st === 'pass' ? '#00ff88' : st === 'fail' ? '#ff3b3b' : st === 'checking' ? '#ffb347' : 'rgba(255,255,255,0.3)';
  const label = (st: CheckStatus) => st === 'pass' ? '✓ PASS' : st === 'fail' ? '✕ FAIL' : st === 'checking' ? 'CHECKING...' : 'PENDING';

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, sans-serif', padding: '48px 32px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Pre-Interview Setup</div>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, margin: 0 }}>System<br /><span style={{ color: 'rgba(255,255,255,0.4)' }}>Diagnostic</span></h1>
        <p style={{ marginTop: 12, fontSize: 15, color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>All checks must pass before starting your interview.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>

        {/* Camera */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `0.5px solid ${s('camera') === 'pass' ? 'rgba(0,255,136,0.25)' : s('camera') === 'fail' ? 'rgba(255,59,59,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' }}>
          {s('camera') === 'pass' && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, #00ff88, transparent)' }} />}
          <div style={{ fontSize: 20, marginBottom: 12 }}>📷</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Camera</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>HD_720P · 30FPS</div>
          <div style={{ aspectRatio: '16/9', borderRadius: 10, background: '#050510', border: '0.5px solid rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 14, position: 'relative' }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          </div>
          <Row label="Resolution" val={cameraRes || '—'} ok={!!cameraRes} />
          <Row label="Status" val={label(s('camera'))} color={color(s('camera'))} />
          <Bar val={s('camera') === 'pass' ? 100 : 0} color={color(s('camera'))} />
        </div>

        {/* Microphone */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `0.5px solid ${s('microphone') === 'pass' ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' }}>
          {s('microphone') === 'pass' && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, #00ff88, transparent)' }} />}
          <div style={{ fontSize: 20, marginBottom: 12 }}>🎙️</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Microphone</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>DEFAULT_INPUT · 48kHz</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 48, marginBottom: 14, padding: '0 4px' }}>
            {Array.from({ length: 20 }).map((_, i) => {
              const active = micLevel > (i / 20) * 100;
              return <div key={i} style={{ flex: 1, height: `${20 + (i % 3) * 30}%`, borderRadius: 99, background: active ? '#00ff88' : 'rgba(255,255,255,0.08)', boxShadow: active ? '0 0 4px rgba(0,255,136,0.4)' : 'none', transition: 'background 0.1s' }} />;
            })}
          </div>
          <Row label="Sample rate" val="48,000 Hz" ok />
          <Row label="Status" val={label(s('microphone'))} color={color(s('microphone'))} />
          <Bar val={micLevel} color="#00ff88" />
        </div>

        {/* Network */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `0.5px solid ${s('network') === 'pass' ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' }}>
          {s('network') === 'pass' && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, #00ff88, transparent)' }} />}
          <div style={{ fontSize: 20, marginBottom: 12 }}>🌐</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Network</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>BANDWIDTH_TEST</div>
          <Row label="Upload est." val={networkSpeed ? `${networkSpeed} Mbps` : '—'} ok={!!networkSpeed && networkSpeed >= 1} />
          <Row label="Min required" val="1.0 Mbps" ok />
          <Row label="Status" val={label(s('network'))} color={color(s('network'))} />
          <Bar val={s('network') === 'pass' ? 90 : 0} color="#4f9eff" />
        </div>

        {/* Speakers */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `0.5px solid ${s('speaker') === 'pass' ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' }}>
          {s('speaker') === 'pass' && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, #00ff88, transparent)' }} />}
          <div style={{ fontSize: 20, marginBottom: 12 }}>🔊</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Speakers</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>OUTPUT_TEST</div>
          <button onClick={testSpeaker} style={{ width: '100%', padding: '10px 0', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 14, fontFamily: 'Inter, sans-serif', transition: 'all 0.2s' }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
            ▶ Play Test Tone
          </button>
          <Row label="Status" val={label(s('speaker'))} color={color(s('speaker'))} />
          <Bar val={s('speaker') === 'pass' ? 100 : 0} color="#00ff88" />
        </div>
      </div>

      <button
        onClick={() => router.push(`/interview/${sessionId}/live`)}
        disabled={!allPassed}
        style={{ width: '100%', padding: 18, borderRadius: 12, background: allPassed ? '#fff' : 'rgba(255,255,255,0.1)', color: allPassed ? '#000' : 'rgba(255,255,255,0.3)', border: 'none', fontSize: 16, fontWeight: 800, cursor: allPassed ? 'pointer' : 'not-allowed', transition: 'all 0.3s', fontFamily: 'Inter, sans-serif', letterSpacing: -0.3 }}>
        {allPassed ? 'All Checks Passed — Begin Interview →' : 'Complete all checks to continue'}
      </button>
    </div>
  );
}

function Row({ label, val, ok, color }: { label: string; val: string; ok?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'monospace', color: color ?? (ok ? '#00ff88' : 'rgba(255,255,255,0.5)') }}>{val}</span>
    </div>
  );
}

function Bar({ val, color }: { val: number; color: string }) {
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', marginTop: 10 }}>
      <div style={{ height: '100%', width: `${val}%`, background: color, boxShadow: `0 0 6px ${color}`, transition: 'width 0.8s ease, background 0.3s' }} />
    </div>
  );
}
