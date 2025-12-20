import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/client.ts"],
    outDir: "dist",
    dts: true,
    sourcemap: true,
    format: "esm",
    external: ["@loro-extended/repo", "reconnecting-eventsource"],
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
    entry: ["src/express.ts"],
    outDir: "dist",
    dts: true,
    sourcemap: true,
    format: "esm",
    external: ["@loro-extended/repo", "express"],
  },
])
