import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), react()],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    // Exclude workspace packages from pre-bundling to ensure we always use the latest built versions
    exclude: [
      "@loro-extended/change",
      "@loro-extended/react",
      "@loro-extended/lea",
      "@loro-extended/repo",
      "@loro-extended/adapter-websocket",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
})
