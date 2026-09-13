import { useEffect, useRef, useState } from "react";
import { getDocument } from "../api/client";
import type { Document } from "../types";

export function usePolling(id: string | null, intervalMs = 2000) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function poll() {
      try {
        const d = await getDocument(id!);
        if (cancelled) return;
        setDoc(d);
        if (d.status === "done" || d.status === "failed") {
          if (timer.current) window.clearInterval(timer.current);
          return;
        }
      } catch (e) {
        setError((e as Error).message);
        if (timer.current) window.clearInterval(timer.current);
      }
    }

    poll();
    timer.current = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [id, intervalMs]);

  return { doc, error };
}
