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
    // Tests for hooks have been moved to @loro-extended/hooks-core
    // This package only contains React-specific bindings
  ],
})
