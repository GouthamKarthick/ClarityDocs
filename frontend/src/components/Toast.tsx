import { useState } from "react";

export type ToastKind = "success" | "info" | "warning" | "error";
export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

const bg: Record<ToastKind, string> = {
  success: "#16a34a", // green - 2xx success
  info: "#16a34a", // green alias
  warning: "#ca8a04", // dark yellow - 4xx user errors (per spec)
  error: "#dc2626", // red - 5xx internal errors
};

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = (kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };
  return { toasts, show, dismiss: (id: string) => setToasts((t) => t.filter((x) => x.id !== id)) };
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          onClick={() => onDismiss(t.id)}
          style={{
            background: bg[t.kind],
            color: "white",
            padding: "10px 14px",
            borderRadius: 8,
            minWidth: 280,
            maxWidth: 420,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            fontSize: 14,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
