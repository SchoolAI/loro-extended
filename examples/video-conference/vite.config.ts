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
  server: {
    // Allow serving on ngrok or similar
    allowedHosts: true,
    proxy: {
      "/loro": {
        target: "http://localhost:5171",
        changeOrigin: true,
        // Required for SSE
        configure: proxy => {
          proxy.on("proxyReq", (_proxyReq, _req, res) => {
            // Prevent proxy from buffering the response
            res.setHeader("X-Accel-Buffering", "no")
          })
          proxy.on("proxyRes", (proxyRes, _req, _res) => {
            // Disable compression which can cause buffering
            delete proxyRes.headers["content-encoding"]
          })
        },
      },
    },
  },
})