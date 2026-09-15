import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resetPassword } from "../api/client";
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await resetPassword(token, pwd);
      nav("/login");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div style={{ maxWidth: 400, margin: "2rem auto" }}>
      <h2>Reset Password</h2>
      <form onSubmit={onSubmit}>
        <input
          type="password"
          placeholder="New password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button>Reset</button>
      </form>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
