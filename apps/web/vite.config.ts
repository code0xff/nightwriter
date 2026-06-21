import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend API origin used by the dev proxy.
const API_TARGET = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
