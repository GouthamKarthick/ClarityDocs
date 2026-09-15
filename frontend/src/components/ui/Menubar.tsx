import { useCallback } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import styles from "./Menubar.module.scss";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";

export function Menubar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const handleLogout = useCallback(async () => {
    await logout();
    nav("/login");
  }, [logout, nav]);
  return (
    <header className={styles.menubar} role="banner">
      <div className={styles["menubar-inner"]}>
        <NavLink
          to="/"
          className={styles["menubar-brand"]}
          aria-label="ClarityDocs home"
        >
          <span className={styles["menubar-logo"]} aria-hidden>
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="32" height="32" rx="9" fill="url(#logoGrad)" />
              <g filter="url(#logoShadow)">
                <path d="M10 9.5H19L22.5 13V23.5H10V9.5Z" fill="white" />
                <path
                  d="M19 9.5V13H22.5"
                  fill="#f1f5f9"
                  stroke="#cbd5e1"
                  strokeWidth="0.9"
                />
                <rect
                  x="12.2"
                  y="15"
                  width="7.5"
                  height="1.3"
                  rx="0.65"
                  fill="#2563eb"
                />
                <rect
                  x="12.2"
                  y="17.4"
                  width="7.5"
                  height="1.3"
                  rx="0.65"
                  fill="#94a3b8"
                />
                <rect
                  x="12.2"
                  y="19.8"
                  width="5.2"
                  height="1.3"
                  rx="0.65"
                  fill="#e2e8f0"
                />
              </g>
              <g>
                <circle
                  cx="19.8"
                  cy="17.2"
                  r="3.4"
                  fill="#0ea5e9"
                  stroke="white"
                  strokeWidth="1.6"
                />
                <circle
                  cx="19.8"
                  cy="17.2"
                  r="1.7"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.9"
                  opacity="0.9"
                />
                <path
                  d="M22.1 19.5L24.2 21.6"
                  stroke="white"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </g>
              <defs>
                <linearGradient
                  id="logoGrad"
                  x1="4"
                  y1="4"
                  x2="28"
                  y2="28"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#2563eb" />
                  <stop offset="1" stopColor="#06b6d4" />
                </linearGradient>
                <filter
                  id="logoShadow"
                  x="8"
                  y="7.5"
                  width="16.5"
                  height="18"
                  filterUnits="userSpaceOnUse"
                  colorInterpolationFilters="sRGB"
                >
                  <feDropShadow
                    dx="0"
                    dy="1"
                    stdDeviation="1"
                    floodColor="#0f172a"
                    floodOpacity="0.12"
                  />
                </filter>
              </defs>
            </svg>
          </span>
          <span className={styles["menubar-title"]}>
            Clarity<span className={styles["menubar-title-accent"]}>Docs</span>
          </span>
        </NavLink>
        <nav className={styles["menubar-nav"]} aria-label="Primary">
          <NavLink
            to="/"
            className={({ isActive }) =>
              isActive ? styles["menubar-active"] : styles["menubar-link"]
            }
          >
            <i className="bi bi-cloud-arrow-up" aria-hidden /> Upload
          </NavLink>
          <NavLink
            to="/documents"
            className={({ isActive }) =>
              isActive ? styles["menubar-active"] : styles["menubar-link"]
            }
          >
            <i className="bi bi-file-earmark-text" aria-hidden /> Documents
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? styles["menubar-active"] : styles["menubar-link"]
            }
          >
            <i className="bi bi-bar-chart-line" aria-hidden /> Dashboard
          </NavLink>
          <button
            onClick={toggle}
            className={styles["menubar-theme"]}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            <i
              className={theme === "dark" ? "bi bi-sun" : "bi bi-moon-stars"}
              aria-hidden
            />
          </button>
          {user ? (
            <>
              <span className={styles["menubar-email"]}>
                <i className="bi bi-person-circle" aria-hidden /> {user.email}
              </span>
              <button onClick={handleLogout} className={styles["menubar-logout"]}>
                <i className="bi bi-box-arrow-right" aria-hidden /> Logout
              </button>
            </>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                isActive ? styles["menubar-active"] : styles["menubar-link"]
              }
            >
              <i className="bi bi-box-arrow-in-right" aria-hidden /> Login
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
