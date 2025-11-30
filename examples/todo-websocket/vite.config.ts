import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
  build: {
    // loro-crdt WASM is ~3MB, so we need to increase the chunk size warning limit
    chunkSizeWarningLimit: 4000,
  },
  server: {
    // Allow serving on ngrok or similar
    allowedHosts: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:5170",
        ws: true,
      },
    },
  },
})