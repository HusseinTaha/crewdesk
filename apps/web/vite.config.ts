import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const hub = process.env.CLAUDE_HUB_URL ?? "http://127.0.0.1:7777";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": hub,
      "/health": hub,
      "/ws": { target: hub.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
