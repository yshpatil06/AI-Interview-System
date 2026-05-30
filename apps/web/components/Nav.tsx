import Link from "next/link";

export default function Nav() {
  return (
    <nav
      className="glass"
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        display: "flex",
        gap: "1.5rem",
        alignItems: "center",
        padding: "0.65rem 1.5rem",
      }}
    >
      <Link href="/" style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
        NEXUS
      </Link>
      <Link href="/start" className="btn-ghost" style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
        Start Interview
      </Link>
      <Link href="/recruiter" className="btn-ghost" style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}>
        Recruiter
      </Link>
    </nav>
  );
}
