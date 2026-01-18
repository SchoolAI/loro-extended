import { defineConfig } from "@halecraft/verify"

export default defineConfig({
  tasks: [
    {
      key: "format",
      run: "../../node_modules/.bin/biome check --write .",
      parser: "biome",
    },
    {
      key: "types",
      run: "./node_modules/.bin/tsgo --noEmit --skipLibCheck",
      parser: "tsc",
      reportingDependsOn: ["format"],
    },
    {
      key: "test",
      run: "./node_modules/.bin/vitest run",
      parser: "vitest",
      reportingDependsOn: ["format", "types"],
    },
  ],
})
