import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSuspiciousFrontend } from "../utils/security";
import { useToastContext } from "../context/ToastContext";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Heading } from "../components/ui/Heading";
import { Text } from "../components/ui/Text";
import styles from "./Upload.module.scss";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const { show } = useToastContext();
  const nav = useNavigate();

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSuspiciousFrontend(email) || isSuspiciousFrontend(password)) {
        show("warning", "Suspicious input detected — not saved");
        return;
      }
      setErr(null);
      setBusy(true);
      try {
        await login(email, password);
        nav("/");
      } catch (error) {
        const msg = (error as Error).message;
        if (msg.includes("SUSPICIOUS")) show("warning", msg);
        setErr(msg);
      } finally {
        setBusy(false);
      }
    },
    [email, password, login, nav, show],
  );

  return (
    <div className="page">
      <div className={styles["upload-card"]}>
        <Heading level={1}>Welcome back</Heading>
        <Text variant="muted">Sign in to continue to ClarityDocs.</Text>

        <form onSubmit={handleSubmit} className={styles["upload-form"]}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="login-email" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
              Email
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{ width: "100%", paddingRight: 42 }}
              />
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 12,
                  color: "var(--color-text-faint)",
                  fontSize: 16,
                  pointerEvents: "none",
                }}
              >
                <i className="bi bi-envelope" />
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
              Password
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ width: "100%", paddingRight: 42 }}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  right: 8,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: 16,
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                <i className={showPassword ? "bi bi-eye-slash" : "bi bi-eye"} aria-hidden />
              </button>
            </div>
          </div>

          {err && (
            <div style={{ color: "var(--color-error)", background: "color-mix(in srgb, var(--color-error) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--color-error) 18%, transparent)", padding: "8px 10px", borderRadius: 8, fontSize: 13 }}>
              {err}
            </div>
          )}

          <Button type="submit" variant="primary" size="md" disabled={busy} style={{ width: "100%" }}>
            {busy ? (
              <>
                <i className="bi bi-arrow-repeat" aria-hidden style={{ animation: "spin 1s linear infinite" }} /> Signing in…
              </>
            ) : (
              <>
                <i className="bi bi-box-arrow-in-right" aria-hidden /> Login
              </>
            )}
          </Button>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
            <Link to="/register" style={{ color: "var(--color-primary)", fontWeight: 600 }}>
              Create account
            </Link>
            <Link to="/forgot-password" style={{ color: "var(--color-text-muted)" }}>
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
