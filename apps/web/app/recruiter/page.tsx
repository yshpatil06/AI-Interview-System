"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Nav from "@/components/Nav";
import { listInterviews, mediaUrl } from "@/lib/api";
import type { AiInterview } from "@ai-interview/shared";

export default function RecruiterPage() {
  const [interviews, setInterviews] = useState<AiInterview[]>([]);
  const [selected, setSelected] = useState<AiInterview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listInterviews()
      .then((data) => {
        setInterviews(data.interviews);
        if (data.interviews[0]) setSelected(data.interviews[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="grid-bg" style={{ minHeight: "100vh", padding: "6rem 1.5rem 3rem" }}>
      <Nav />
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>Recruiter dashboard</h1>
        <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>
          Unified view: candidate profile, suspicious activity, transcripts, and playback.
        </p>

        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
            <div className="glass" style={{ padding: "0.75rem", maxHeight: "70vh", overflow: "auto" }}>
              {interviews.length === 0 && (
                <p style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                  No interviews yet. Start one from the candidate flow.
                </p>
              )}
              {interviews.map((iv) => (
                <button
                  key={iv.id}
                  type="button"
                  onClick={() => setSelected(iv)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "0.85rem",
                    borderRadius: 10,
                    border: "none",
                    background: selected?.id === iv.id ? "var(--surface)" : "transparent",
                    color: "var(--text)",
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{iv.candidateName}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{iv.role}</div>
                  <span className="badge" style={{ marginTop: 6 }}>
                    {iv.status}
                  </span>
                </button>
              ))}
            </div>

            {selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className="glass"
                style={{ padding: "1.5rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h2 style={{ fontSize: "1.35rem" }}>{selected.candidateName}</h2>
                    <p style={{ color: "var(--muted)" }}>{selected.candidateEmail}</p>
                  </div>
                  {selected.aiScore != null && (
                    <div
                      style={{
                        fontSize: "2rem",
                        fontWeight: 700,
                        color: "var(--accent)",
                      }}
                    >
                      {selected.aiScore}
                    </div>
                  )}
                </div>

                {selected.aiSummary && (
                  <p style={{ marginTop: "1rem", lineHeight: 1.5, fontSize: "0.95rem" }}>{selected.aiSummary}</p>
                )}

                <section style={{ marginTop: "1.5rem" }}>
                  <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Proctoring flags ({selected.session_data.suspiciousEvents.length})
                  </h3>
                  <ul style={{ marginTop: "0.5rem", listStyle: "none", fontSize: "0.85rem" }}>
                    {selected.session_data.suspiciousEvents.length === 0 && (
                      <li style={{ color: "var(--muted)" }}>No flags recorded</li>
                    )}
                    {selected.session_data.suspiciousEvents.map((e) => (
                      <li key={e.id} style={{ padding: "0.35rem 0", borderBottom: "1px solid var(--border)" }}>
                        <span className="badge-warn badge">{e.type}</span>
                        <span style={{ marginLeft: 8, color: "var(--muted)" }}>
                          {new Date(e.timestamp).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section style={{ marginTop: "1.5rem" }}>
                  <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Responses
                  </h3>
                  {selected.session_data.answers.map((a) => (
                    <div
                      key={a.questionId}
                      style={{
                        marginTop: "1rem",
                        padding: "1rem",
                        background: "var(--bg)",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <span className="badge">{a.questionId}</span>
                        <span className="badge">{a.mergeStatus}</span>
                      </div>
                      {a.transcript && (
                        <p style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "0.75rem" }}>{a.transcript}</p>
                      )}
                      {a.mergeStatus === "done" && (
                        <video
                          controls
                          src={mediaUrl(selected.id, a.questionId)}
                          style={{ width: "100%", borderRadius: 8, maxHeight: 240 }}
                        />
                      )}
                    </div>
                  ))}
                </section>
              </motion.div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
