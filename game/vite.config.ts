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
  test: {
    // Without this, `import styles from "./style.css?inline"` resolves to an EMPTY STRING
    // in vitest. Every assertion over the stylesheet then passes against nothing — which
    // is how `expect(styles).not.toContain('content: " MERCS"')` in dom.test.ts has been
    // green while proving nothing at all. Processing CSS makes those checks real.
    css: true,
  },
});
