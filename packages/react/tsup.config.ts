import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  sourcemap: true,
  format: "esm",
  external: ["loro-crdt"],
})
