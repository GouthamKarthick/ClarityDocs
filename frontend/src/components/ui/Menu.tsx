import type { ReactNode } from "react";
import styles from "./Menu.module.scss";

export interface MenuItem {
  label: string;
  value: string;
}

interface Props {
  items: MenuItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

/**
 * Menu — reusable single-select pill menu (used as filter / view toggle).
 * Keeps styling consistent; behavior is controlled.
 */
export function Menu({ items, value, onChange, ariaLabel }: Props) {
  return (
    <div className={styles.menu} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value || "__all"}
            role="tab"
            aria-selected={active}
            className={
              active ? styles["menu-item--active"] : styles["menu-item"]
            }
            onClick={() => onChange(item.value)}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// Also export a generic dropdown-style Menu for future use
export function DropdownMenu({
  trigger,
  children,
}: {
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles["menu-dropdown"]}>
      <div className={styles["menu-trigger"]}>{trigger}</div>
      <div className={styles["menu-panel"]} role="menu">
        {children}
      </div>
    </div>
  );
}
