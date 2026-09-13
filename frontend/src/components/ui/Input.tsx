import type { InputHTMLAttributes } from "react";
import styles from "./Input.module.scss";

interface Props extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...rest }: Props) {
  const cls = [styles.input, className].filter(Boolean).join(" ");
  return <input className={cls} {...rest} />;
}
