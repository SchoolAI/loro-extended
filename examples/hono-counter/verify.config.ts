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
      run: "./node_modules/.bin/tsgo --noEmit",
      parser: "tsc",
      reportingDependsOn: ["format"],
    },
  ],
})
