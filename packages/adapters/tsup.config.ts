import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/network/sse/client.ts", "src/network/sse/server.ts"],
    outDir: "dist/network/sse",
    dts: true,
    sourcemap: true,
    format: "esm",
  },
  {
    entry: ["src/storage/indexed-db/client.ts"],
    outDir: "dist/storage/indexed-db",
    dts: true,
    sourcemap: true,
    format: "esm",
  },
  {
    entry: ["src/storage/level-db/server.ts"],
    outDir: "dist/storage/level-db",
    dts: true,
    sourcemap: true,
    format: "esm",
  },
])
