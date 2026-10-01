import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// This app is the React front-end for the backend/ Express + SQLite app
// (see ../backend/server.js). The backend is left completely alone -- it
// keeps serving /api/* and the static /public directory exactly as before.
// This config just:
//   1. proxies /api and /icons during `npm run dev` so the Vite dev server
//      can talk to the backend running on :3000 without CORS headaches, and
//   2. builds straight into the backend's public/ folder so `npm run build`
//      here + `npm start` in the backend is the whole deploy story -- no
//      separate static host needed. (The Dockerfile at the project root
//      does the equivalent as a multi-stage build; see there for
//      the containerized path, which builds into its own throwaway
//      filesystem rather than this one.)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/icons": "http://localhost:3000",
    },
  },
  build: {
    outDir: process.env.VITE_OUT_DIR || "../backend/public",
    emptyOutDir: false, // keep /icons (5MB of champion/rank art) in place
    assetsDir: "assets",
  },
});
