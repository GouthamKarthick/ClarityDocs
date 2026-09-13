import { createContext, useContext, type ReactNode } from "react";
import { useToast, ToastContainer, type ToastKind } from "./Toast";

type ToastContextValue = {
  show: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
  return ctx;
}

export function kindFromStatus(status: number): ToastKind {
  if (status >= 500) return "error"; // 5xx internal - red #dc2626
  if (status >= 400) return "warning"; // 4xx user - dark yellow #ca8a04
  if (status >= 200) return "success"; // 2xx success - green
  return "error";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, show, dismiss } = useToast();
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
