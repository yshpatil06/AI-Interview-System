"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import { verifyHardware } from "@/lib/api";

export default function HardwareCheckPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const token = search.get("token") ?? "";
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [error, setError] = useState("");

  const startPreview = useCallback(async () => {
    setStatus("checking");
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 1280, height: 720 },
        audio: true,
      });
      setStream(media);
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play();
      }

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(media);
      source.connect(analyser);
      analyser.fftSize = 256;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round(avg)));
        requestAnimationFrame(tick);
      };
      tick();

      setStatus("ok");
    } catch {
      setStatus("fail");
      setError("Camera or microphone unavailable. Check permissions and retry.");
    }
  }, []);

  useEffect(() => {
    startPreview();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [startPreview]);

  async function proceed() {
    await verifyHardware(id);
    router.push(`/interview/${id}/room?token=${token}`);
  }

  return (
    <main className="grid-bg" style={{ minHeight: "100vh", padding: "6rem 1.5rem" }}>
      <Nav />
      <div className="glass" style={{ maxWidth: 720, margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Hardware check</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>
          Confirm your camera and mic work before entering the interview room.
        </p>

        <div
          style={{
            aspectRatio: "16/9",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid var(--border)",
            marginBottom: "1rem",
          }}
        >
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Microphone level</span>
          <div
            style={{
              height: 8,
              background: "var(--bg)",
              borderRadius: 4,
              marginTop: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${micLevel}%`,
                background: micLevel > 8 ? "var(--success)" : "var(--danger)",
                transition: "width 0.1s",
              }}
            />
          </div>
        </div>

        {error && <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>{error}</p>}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="button" className="btn-ghost" onClick={startPreview}>
            Retry
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={status !== "ok"}
            onClick={proceed}
          >
            Enter interview room
          </button>
        </div>
      </div>
    </main>
  );
}
