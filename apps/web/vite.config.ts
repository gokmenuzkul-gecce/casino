import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    // Dev tunnels rewrite the Host header, so accept any host in development.
    allowedHosts: true,
    proxy: {
      "/api": { target: process.env.ENGINE_URL ?? "http://localhost:4000", changeOrigin: true },
      "/webhooks": { target: process.env.ENGINE_URL ?? "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: process.env.ENGINE_URL ?? "http://localhost:4000", ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
