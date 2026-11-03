import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(frontendDir, "..");
const ocrAssets = {
  "worker.min.js": path.join(frontendDir, "node_modules/tesseract.js/dist/worker.min.js"),
  "eng.traineddata.gz": path.join(frontendDir, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
};
for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"]) {
  for (const extension of ["wasm.js", "wasm"]) {
    const name = `tesseract-core-${variant}.${extension}`;
    ocrAssets[name] = path.join(frontendDir, "node_modules/tesseract.js-core", name);
  }
}

function localOcrAssets() {
  const virtualModuleId = "virtual:champion-icon-keys";
  const resolvedVirtualModuleId = `\0${virtualModuleId}`;
  const iconDirectory = path.join(repoDir, "backend/public/icons/champions");
  let command = "serve";
  return {
    name: "local-ocr-assets",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      return id === virtualModuleId ? resolvedVirtualModuleId : null;
    },
    load(id) {
      if (id !== resolvedVirtualModuleId) return null;
      const keys = fs
        .readdirSync(iconDirectory)
        .filter((file) => file.toLowerCase().endsWith(".png"))
        .map((file) => path.basename(file, path.extname(file)))
        .sort();
      return `export default ${JSON.stringify(keys)};`;
    },
    buildStart() {
      if (command !== "build") return;
      for (const [name, file] of Object.entries(ocrAssets)) {
        this.emitFile({
          type: "asset",
          fileName: name === "eng.traineddata.gz" ? "ocr/lang/eng.traineddata.gz" : `ocr/${name}`,
          source: fs.readFileSync(file),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use("/ocr", (request, response, next) => {
        const name = path.basename(new URL(request.url, "http://localhost").pathname);
        const asset = Object.entries(ocrAssets).find(([key]) => key === name);
        if (!asset) return next();
        response.setHeader(
          "Content-Type",
          name.endsWith(".js") ? "text/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        );
        fs.createReadStream(asset[1]).pipe(response);
      });
    },
  };
}

// This app is the React front-end for the backend/ Express + SQLite app
// (see ../backend/server.js). The backend serves /api/* and the static build.
// This config:
//   1. proxies /api and /icons during `npm run dev` so the Vite dev server
//      can talk to the backend running on :3000 without CORS headaches, and
//   2. builds straight into the backend's public/ folder so `npm run build`
//      here + `npm start` in the backend is the whole deploy story -- no
//      separate static host needed. (The Dockerfile at the project root
//      does the equivalent as a multi-stage build; see there for
//      the containerized path, which builds into its own throwaway
//      filesystem rather than this one.) OCR runtime and model files are
//      emitted under /ocr so screenshots can be read locally.
export default defineConfig({
  plugins: [react(), localOcrAssets()],
  cacheDir: ".vite",
  server: {
    port: 5173,
    fs: { allow: [repoDir] },
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000", // OIDC login redirect + callback
      "/icons": "http://localhost:3000",
    },
  },
  build: {
    outDir: process.env.VITE_OUT_DIR || "../backend/public",
    emptyOutDir: false, // keep /icons (5MB of champion/rank art) in place
    assetsDir: "assets",
  },
});
