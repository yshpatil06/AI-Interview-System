"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import Nav from "@/components/Nav";

const HeroScene = dynamic(() => import("@/components/HeroScene"), { ssr: false });

export default function HomePage() {
  return (
    <main className="grid-bg" style={{ minHeight: "100vh", position: "relative" }}>
      <HeroScene />
      <Nav />

      <section
        style={{
          position: "relative",
          zIndex: 10,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "6rem 1.5rem 4rem",
          textAlign: "center",
        }}
      >
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="badge"
          style={{ marginBottom: "1.25rem" }}
        >
          AI Video Screening Platform
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1.05,
            maxWidth: 900,
          }}
        >
          Scale first-round interviews
          <br />
          <span style={{ color: "var(--muted)" }}>without losing fidelity</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          style={{
            marginTop: "1.5rem",
            maxWidth: 560,
            color: "var(--muted)",
            fontSize: "1.1rem",
            lineHeight: 1.6,
          }}
        >
          Stream video chunks in real time, recover from disconnects, and give recruiters
          transcripts, playback, and proctoring signals in one dashboard.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          style={{ marginTop: "2.5rem", display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}
        >
          <Link href="/start" className="btn-primary">
            Begin as Candidate
          </Link>
          <Link href="/recruiter" className="btn-ghost">
            Recruiter Dashboard
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="glass"
          style={{
            marginTop: "4rem",
            padding: "1.5rem 2rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1.5rem",
            maxWidth: 720,
            width: "100%",
          }}
        >
          {[
            ["Streaming", "Chunk upload + WS"],
            ["Recovery", "Resume sessions"],
            ["Proctoring", "Tab & focus flags"],
            ["AI STT", "Deepgram-ready"],
          ].map(([title, sub]) => (
            <div key={title}>
              <div style={{ fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </motion.div>
      </section>
    </main>
  );
}
