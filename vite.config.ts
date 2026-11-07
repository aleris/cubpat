import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build can be served from any folder.
  base: "./",
  build: {
    target: "es2022",
    // PlayCanvas ships as one large module; keep the warning threshold realistic.
    chunkSizeWarningLimit: 1400
  }
});
