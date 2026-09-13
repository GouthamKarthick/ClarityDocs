import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.scss";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", children, className, disabled, ...rest }: Props) {
  const cls = [styles.button, styles[`button-${variant}`], styles[`button-${size}`], className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}
