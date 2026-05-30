const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export async function createInterview(body: {
  candidateName: string;
  candidateEmail: string;
  role: string;
}) {
  const res = await fetch(`${API}/interviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create interview");
  return res.json() as Promise<{
    interview: { id: string; session_data: { resumeToken: string } };
    joinUrl: string;
  }>;
}

export async function fetchInterview(id: string) {
  const res = await fetch(`${API}/interviews/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Interview not found");
  return res.json();
}

export async function listInterviews() {
  const res = await fetch(`${API}/interviews`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to list");
  return res.json();
}

export async function verifyHardware(id: string) {
  const res = await fetch(`${API}/interviews/${id}/hardware`, { method: "PATCH" });
  if (!res.ok) throw new Error("Hardware verify failed");
  return res.json();
}

export function mediaUrl(sessionId: string, questionId: string) {
  return `${API}/interviews/${sessionId}/media/${questionId}`;
}

export function wsUrl() {
  const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
  return `${base}/ws/interview`;
}
