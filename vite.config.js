import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// mdread builds to ./dist, which is what Cloudflare serves (see wrangler.jsonc).
// The vendored libraries are now real dependencies (marked, dompurify, highlight.js)
// bundled into a single `vendor` chunk, so the app still makes zero external
// requests at runtime — they're just self-hosted from our own origin.
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Keep the three markdown libraries in their own long-lived `vendor`
        // chunk so app-code edits don't bust their cache. (Rolldown wants a
        // function here, not the classic object form.)
        manualChunks(id) {
          if (/node_modules\/(marked|dompurify|highlight\.js)\//.test(id)) return "vendor";
          // The editor is its own long-lived chunk for the same reason.
          if (/node_modules\/(@codemirror|@lezer|style-mod|w3c-keyname|crelt)\//.test(id)) return "editor";
          // Yjs is only reached through the dynamic import in share.js, so it
          // stays a lazy chunk — a reader who never co-edits never fetches it.
          // y-codemirror.next is left out on purpose: Rolldown pulls a matched
          // module's dependencies into its group, which would drag CodeMirror
          // itself in here and make this chunk load eagerly. Unmatched, it rides
          // along with collab.js's own lazy chunk.
          if (/node_modules\/(yjs|lib0)\//.test(id)) return "collab";
        },
      },
    },
  },
  plugins: [
    VitePWA({
      // auto-update the cached app shell on the next visit after a deploy
      registerType: "autoUpdate",
      injectRegister: "auto",
      // keep the hand-written public/manifest.webmanifest instead of generating one
      manifest: false,
      includeAssets: ["icons/icon.svg", "manifest.webmanifest", "og-image.png"],
      workbox: {
        // precache the hashed build output (Workbox fills in the real filenames)
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // /s/<id> share links must resolve to the app shell offline too, but the
        // share API is never a navigation and must never be served from cache.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
      // no service worker in `vite dev` — it only gets in the way locally
      devOptions: { enabled: false },
    }),
  ],
});
