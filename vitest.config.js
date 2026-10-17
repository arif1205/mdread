import { defineConfig } from "vitest/config";

// Kept apart from vite.config.js so tests don't load the PWA plugin. Tests cover
// the pure modules only (crypto, bundle, refs) and run in plain Node, which has
// WebCrypto, CompressionStream and atob/btoa built in.
export default defineConfig({
  test: { include: ["test/**/*.test.js"], environment: "node" },
});
