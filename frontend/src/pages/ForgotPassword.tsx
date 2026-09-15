import { useState } from "react";
import { forgotPassword } from "../api/client";
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await forgotPassword(email);
    setMsg("If email exists, reset link sent (Resend free)");
  }
  return (
    <div style={{ maxWidth: 400, margin: "2rem auto" }}>
      <h2>Forgot Password</h2>
      <form onSubmit={onSubmit}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button>Send reset</button>
      </form>
      {msg && <p style={{ color: "green" }}>{msg}</p>}
    </div>
  );
}
