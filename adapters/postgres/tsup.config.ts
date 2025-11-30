import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/server.ts"],
  outDir: "dist",
  dts: true,
  sourcemap: true,
  format: "esm",
  external: ["@loro-extended/repo", "pg"],
})