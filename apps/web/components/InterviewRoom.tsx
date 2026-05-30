"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsServerMessage } from "@ai-interview/shared";
import { DEFAULT_QUESTIONS } from "@ai-interview/shared";
import { InterviewSocket } from "@/lib/interviewSocket";

const CHUNK_MS = 2500;

type Props = {
  sessionId: string;
  resumeToken: string;
  candidateName: string;
};

export default function InterviewRoom({ sessionId, resumeToken, candidateName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sequenceRef = useRef(0);
  const socketRef = useRef<InterviewSocket | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [flags, setFlags] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const question = DEFAULT_QUESTIONS[questionIndex];

  const speakQuestion = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1;
    setAiSpeaking(true);
    utter.onend = () => setAiSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, []);

  useEffect(() => {
    speakQuestion(question.text);
  }, [question.id, question.text, speakQuestion]);

  useEffect(() => {
    const socket = new InterviewSocket(sessionId, resumeToken, {
      onOpen: () => setWsStatus("connected"),
      onClose: () => setWsStatus("reconnecting"),
      onMessage: (msg: WsServerMessage) => {
        if (msg.type === "auth_ok" && msg.missingChunks.length > 0) {
          socket.requestMissingChunks(question.id);
        }
        if (msg.type === "missing_chunks" && msg.sequences.length > 0) {
          setFlags((f) => [...f, `Recovering ${msg.sequences.length} chunks`]);
        }
        if (msg.type === "question_advanced") {
          setQuestionIndex(msg.index);
          sequenceRef.current = 0;
        }
        if (msg.type === "interview_complete") setDone(true);
      },
    });
    socketRef.current = socket;
    socket.connect();

    return () => socket.close();
  }, [sessionId, resumeToken, question.id]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) socketRef.current?.proctor("tab_switch");
    };
    const onBlur = () => socketRef.current?.proctor("window_blur");
    const onCopy = () => socketRef.current?.proctor("copy_paste");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
    };
  }, []);

  useEffect(() => {
    let faceTimer: ReturnType<typeof setInterval> | null = null;
    const checkFace = () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoRef.current, 0, 0, 64, 48);
      const data = ctx.getImageData(0, 0, 64, 48).data;
      let brightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        brightness += data[i] + data[i + 1] + data[i + 2];
      }
      brightness /= data.length / 4;
      if (brightness < 25) {
        socketRef.current?.proctor("face_absent", { brightness });
      }
    };
    faceTimer = setInterval(checkFace, 5000);
    return () => {
      if (faceTimer) clearInterval(faceTimer);
    };
  }, []);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (!ev.data.size) return;
      const seq = sequenceRef.current++;
      socketRef.current?.sendChunk(question.id, seq, ev.data);
    };

    recorder.onerror = () => {
      setFlags((f) => [...f, "Recorder error — check camera/mic"]);
    };

    recorder.start(CHUNK_MS);
    setRecording(true);

    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      setFlags((f) => [...f, "Camera disconnected"]);
      socketRef.current?.proctor("face_absent", { reason: "track_ended" });
    });
  }, [question.id]);

  const stopAndNext = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
    socketRef.current?.completeQuestion(question.id);
    if (questionIndex >= DEFAULT_QUESTIONS.length - 1) {
      setDone(true);
    }
  }, [question.id, questionIndex]);

  if (done) {
    return (
      <div className="glass" style={{ padding: "2rem", textAlign: "center" }}>
        <h2>Interview submitted</h2>
        <p style={{ color: "var(--muted)", marginTop: "0.75rem" }}>
          Your responses are merging and transcribing. Recruiters can review them in the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1.5rem" }}>
      <div>
        <div
          style={{
            aspectRatio: "16/9",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
          {!recording ? (
            <button type="button" className="btn-primary" onClick={startRecording} disabled={aiSpeaking}>
              {aiSpeaking ? "AI asking question…" : "Start answer"}
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={stopAndNext}>
              Finish answer
            </button>
          )}
        </div>
      </div>

      <aside className="glass" style={{ padding: "1.25rem" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Candidate</p>
        <p style={{ fontWeight: 600, marginBottom: "1rem" }}>{candidateName}</p>
        <p className="badge" style={{ marginBottom: "1rem" }}>
          Q{questionIndex + 1} / {DEFAULT_QUESTIONS.length}
        </p>
        <p style={{ fontSize: "0.95rem", lineHeight: 1.5, marginBottom: "1rem" }}>{question.text}</p>
        <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          WS:{" "}
          <span className={wsStatus === "connected" ? "badge-ok" : "badge-warn"}>
            {wsStatus}
          </span>
        </p>
        {flags.length > 0 && (
          <ul style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--danger)", listStyle: "none" }}>
            {flags.slice(-5).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
