import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Distinct names: VITE_BACKEND_URL (preferred) or legacy VITE_API_URL; also for vite.config proxy
  const apiTarget = env.VITE_BACKEND_URL || env.VITE_API_URL || "http://localhost:4000";
  return {
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/health": apiTarget,
    },
  },
  build: {
    target: "esnext",
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"],
  },
};
});
