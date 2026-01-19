import { defineConfig, parsers } from "@halecraft/verify"

export default defineConfig({
  tasks: [
    {
      key: "format",
      run: "biome check --write .",
      parser: parsers.biome,
    },
    {
      key: "types",
      reportingDependsOn: ["format"],
      children: [
        {
          key: "app",
          run: "tsgo --noEmit --skipLibCheck -p tsconfig.app.json",
          parser: parsers.tsc,
        },
        {
          key: "node",
          run: "tsgo --noEmit --skipLibCheck -p tsconfig.node.json",
          parser: parsers.tsc,
        },
      ],
    },
    {
      key: "logic",
      run: "vitest run",
      parser: parsers.vitest,
    },
  ],
  env: {
    NO_COLOR: "1",
  },
})
