import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/client.ts"],
    outDir: "dist",
    dts: true,
    sourcemap: true,
    format: "esm",
    external: ["@loro-extended/repo"],
  },
  {
    entry: ["src/server.ts"],
    outDir: "dist",
    dts: true,
    sourcemap: true,
    format: "esm",
    external: ["@loro-extended/repo"],
  },
  {
    entry: ["src/protocol/index.ts"],
    outDir: "dist/protocol",
    dts: true,
    sourcemap: true,
    format: "esm",
    external: ["@loro-extended/repo"],
  },
])