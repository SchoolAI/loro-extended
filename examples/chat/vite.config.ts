import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

// https://vite.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [react(), wasm(), topLevelAwait(), tailwindcss()],
  optimizeDeps: {
    exclude: ["loro-crdt"],
  },
})
