import styles from "./FormattedDate.module.scss";

interface Props {
  iso: string;
  className?: string;
  inline?: boolean;
}

export function FormattedDate({ iso, className, inline = false }: Props) {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const variant = inline ? styles["formatted-date--inline"] : undefined;

  return (
    <span
      className={[styles["formatted-date"], variant, className]
        .filter(Boolean)
        .join(" ")}
      title={d.toLocaleString()}
    >
      <span className={styles["formatted-date-date"]}>
        {dateStr}
        {inline ? "," : ""}
      </span>
      <span className={styles["formatted-date-time"]}>{timeStr}</span>
    </span>
  );
}
