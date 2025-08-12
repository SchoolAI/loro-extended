import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  server: {
    proxy: { "/loro": "http://localhost:5170" },
  },
  plugins: [react(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
})
