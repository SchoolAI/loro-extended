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
      run: "tsgo --noEmit --skipLibCheck",
      parser: parsers.tsc,
      reportingDependsOn: ["format"],
    },
    {
      key: "test-e2e",
      run: "playwright test",
      reportingDependsOn: ["format", "types"],
    },
  ],
  env: {
    NO_COLOR: "1",
  },
})
