import type { ReactNode } from "react";
import styles from "./Heading.module.scss";

type Level = 1 | 2 | 3;

interface Props {
  level?: Level;
  children: ReactNode;
  muted?: string; // optional subtitle / count
  className?: string;
}

export function Heading({ level = 2, children, muted, className }: Props) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  const cls = [styles.heading, styles[`heading-h${level}`], className].filter(Boolean).join(" ");
  return (
    <Tag className={cls}>
      {children}
      {muted && <span className={styles['heading-muted']}>{muted}</span>}
    </Tag>
  );
}
