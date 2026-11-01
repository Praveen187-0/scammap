import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const api = "http://localhost:8080";

export default defineConfig({
  root: here,
  // Read VITE_* variables (only those, so server secrets never reach the browser) from the project's .env.
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/public", import.meta.url)),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 900,
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    // `npm run dev:client` proxies API calls to the server running on :8080.
    proxy: Object.fromEntries(["/reports", "/lookup", "/map", "/alerts", "/admin", "/challenges", "/license", "/health", "/analyze", "/stats", "/insights", "/datasets", "/live", "/campaigns", "/network", "/push", "/partner", "/rollups", "/system", "/connectors", "/transparency", "/privacy", "/ocr", "/.well-known", "/safety", "/demo", "/threats"].map((p) => [p, api])),
  },
});
