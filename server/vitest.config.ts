import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites share one database and truncate tables between cases, so
    // they must not run concurrently with each other.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
