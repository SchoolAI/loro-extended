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
      run: "tsgo --noEmit",
      parser: parsers.tsc,
      reportingDependsOn: ["format"],
    },
  ],
  env: {
    NO_COLOR: "1",
  },
})
