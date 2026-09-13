import type { SelectHTMLAttributes } from "react";
import styles from "./Select.module.scss";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className, children, ...rest }: Props) {
  const cls = [styles.select, className].filter(Boolean).join(" ");
  return (
    <select className={cls} {...rest}>
      {children}
    </select>
  );
}
