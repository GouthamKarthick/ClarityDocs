import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from "react";
import { ToastContainer, type ToastKind, type ToastItem } from "../components/Toast";

type ToastContextValue = { show: (kind: ToastKind, message: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
  return ctx;
}

export function kindFromStatus(status: number): ToastKind {
  if (status >= 500) return "error";
  if (status >= 400) return "warning";
  if (status >= 200) return "success";
  return "error";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
