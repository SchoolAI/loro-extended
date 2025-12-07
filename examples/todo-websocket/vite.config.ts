import react from "@vitejs/plugin-react"
import { createLogger, defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

// Create a custom logger that filters out expected EPIPE/ECONNRESET WebSocket proxy shutdown errors
const logger = createLogger()
const originalError = logger.error.bind(logger)
logger.error = (msg, options) => {
  if (
    typeof msg === "string" &&
    msg.includes("ws proxy") &&
    (msg.includes("EPIPE") || msg.includes("ECONNRESET"))
  ) {
    return
  }
  originalError(msg, options)
}

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  customLogger: logger,
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
  build: {
    // loro-crdt WASM is ~3MB, so we need to increase the chunk size warning limit
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 8002,
    // Allow serving on ngrok or similar
    allowedHosts: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:8003",
        ws: true,
      },
    },
  },
})
