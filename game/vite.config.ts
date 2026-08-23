import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  server: {
    strictPort: true,
    port: 4173,
  },
});
