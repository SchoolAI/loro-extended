import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/client.ts", "src/server.ts"],
  dts: true,
  sourcemap: true,
  format: "esm",
})
