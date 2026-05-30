"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Nav from "@/components/Nav";
import { createInterview } from "@/lib/api";

export default function StartPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Software Engineer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { interview } = await createInterview({
        candidateName: name,
        candidateEmail: email,
        role,
      });
      const token = interview.session_data.resumeToken;
      router.push(`/interview/${interview.id}/hardware?token=${token}`);
    } catch {
      setError("Could not start interview. Is the API running on port 4000?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid-bg" style={{ minHeight: "100vh", padding: "6rem 1.5rem 3rem" }}>
      <Nav />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass"
        style={{ maxWidth: 480, margin: "0 auto", padding: "2rem" }}
      >
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Start your interview</h1>
        <p style={{ color: "var(--muted)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
          We will verify your camera and microphone before the AI interviewer begins.
        </p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Full name</span>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} style={{ marginTop: 6 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 6 }} />
          </label>
          <label>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Role</span>
            <input className="input" required value={role} onChange={(e) => setRole(e.target.value)} style={{ marginTop: 6 }} />
          </label>
          {error && <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Creating session…" : "Continue to hardware check"}
          </button>
        </form>
      </motion.div>
    </main>
  );
}
