import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^@\//, replacement: "/src/" }] },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "safari16", chunkSizeWarningLimit: 4000 },
  // Vitest blanks CSS by default; tests that read stylesheets as text need `?raw` to load them.
  test: { css: { include: [/\.css\?raw$/] } },
});
