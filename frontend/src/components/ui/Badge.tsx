import type { ReactNode } from "react";
import styles from "./Badge.module.scss";

type Variant = "neutral" | "info" | "success" | "warning" | "error" | "type";
interface Props {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className }: Props) {
  const cls = [styles.badge, styles[`badge-${variant}`], className].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}
