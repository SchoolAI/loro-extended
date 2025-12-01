import react from "@vitejs/plugin-react"
import { createLogger, defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

// Filter out expected WebSocket proxy shutdown errors
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

export default defineConfig({
  clearScreen: false,
  customLogger: logger,
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
  build: {
    chunkSizeWarningLimit: 4000, // loro-crdt WASM is ~3MB
  },
  server: {
    allowedHosts: true,
    proxy: {
      "/ws": {
        target: "ws://localhost:5170",
        ws: true,
      },
    },
  },
})
