import devServer, { defaultOptions } from "@hono/vite-dev-server"
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"

// Change the import to use your runtime specific build
import build from "@hono/vite-build/node"

export default defineConfig(({ mode }) => {
  // Common optimizeDeps config for loro-crdt WASM
  const optimizeDeps = {
    exclude: ["loro-crdt"],
  }

  if (mode === "client")
    return {
      optimizeDeps,
      plugins: [wasm()],
      esbuild: {
        jsxImportSource: "hono/jsx/dom", // Optimized for hono/jsx/dom
      },
      build: {
        target: "esnext", // Support top-level await and WASM
        rollupOptions: {
          input: "./src/client.tsx",
          output: {
            entryFileNames: "static/client.js",
          },
        },
      },
    }

  return {
    optimizeDeps,
    plugins: [
      wasm(),
      build({
        entry: "src/index.tsx",
      }),
      devServer({
        entry: "src/index.tsx",
        // Exclude WASM files and the vite-plugin-wasm helper from the dev server
        // so Vite can handle them directly
        exclude: [
          /.*\.wasm$/,
          /.*\.wasm\?.*$/,
          /^\/__vite-plugin-wasm-helper$/,
          ...defaultOptions.exclude,
        ],
      }),
    ],
    build: {
      // loro-crdt WASM is ~3MB, so we need to increase the chunk size warning limit
      chunkSizeWarningLimit: 4000,
    },
  }
})
