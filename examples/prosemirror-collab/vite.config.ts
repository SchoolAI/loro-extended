import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm(), tailwindcss()],
  optimizeDeps: {
    // loro-crdt uses WASM, exclude from pre-bundling
    exclude: ["loro-crdt"],
  },
  build: {
    // loro-crdt WASM is ~3MB, increase chunk size warning limit
    chunkSizeWarningLimit: 4000,
  },
  // Note: No server.proxy config needed since we use Vite in middleware mode
  // inside Fastify, which handles WebSocket connections directly.
})
