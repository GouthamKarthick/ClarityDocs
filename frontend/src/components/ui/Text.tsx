import type { ReactNode } from "react";
import styles from "./Text.module.scss";
type Variant = "body" | "muted" | "small" | "mono";
type As = "p" | "span" | "div";

interface Props {
  variant?: Variant;
  as?: As;
  children: ReactNode;
  className?: string;
}

export function Text({ variant = "body", as = "p", children, className }: Props) {
  const Tag = as;
  const cls = [styles.text, styles[`text-${variant}`], className].filter(Boolean).join(" ");
  return <Tag className={cls}>{children}</Tag>;
}
