import { defineConfig } from "tsup"

// Note: tsup automatically externalizes dependencies listed in package.json,
// including workspace dependencies. We only need to explicitly list peer
// dependencies that are optional (like express) since tsup wouldn't know
// to externalize them otherwise.

const common = {
  outDir: "dist",
  dts: true,
  sourcemap: true,
  format: "esm",
} as const

export default defineConfig([
  {
    ...common,
    entry: ["src/client.ts"],
  },
  {
    ...common,
    entry: ["src/server.ts"],
  },
  {
    ...common,
    entry: ["src/express.ts"],
    // express is an optional peerDependency, so we must explicitly externalize it
    external: ["express"],
  },
])
