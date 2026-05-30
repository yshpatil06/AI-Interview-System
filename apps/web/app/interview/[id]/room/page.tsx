"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import InterviewRoom from "@/components/InterviewRoom";
import { fetchInterview } from "@/lib/api";

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const token = search.get("token") ?? "";
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInterview(id)
      .then((data) => setName(data.interview.candidateName))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading session…</p>
      </main>
    );
  }

  return (
    <main className="grid-bg" style={{ minHeight: "100vh", padding: "6rem 1.5rem 3rem" }}>
      <Nav />
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1.25rem" }}>Live interview</h1>
        <InterviewRoom sessionId={id} resumeToken={token} candidateName={name} />
      </div>
    </main>
  );
}
