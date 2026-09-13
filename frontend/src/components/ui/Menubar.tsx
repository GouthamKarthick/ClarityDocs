import { NavLink } from "react-router-dom";
import styles from "./Menubar.module.scss";

export function Menubar() {
  return (
    <header className={styles.menubar} role="banner">
      <div className={styles['menubar-inner']}>
        <NavLink to="/" className={styles['menubar-brand']} aria-label="ClarityDocs home">
          <span className={styles['menubar-logo']}>◈</span> ClarityDocs
        </NavLink>
        <nav className={styles['menubar-nav']} aria-label="Primary">
          <NavLink to="/" className={({ isActive }) => (isActive ? styles['menubar-active'] : styles['menubar-link'])}>
            Upload
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => (isActive ? styles['menubar-active'] : styles['menubar-link'])}>
            Documents
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
