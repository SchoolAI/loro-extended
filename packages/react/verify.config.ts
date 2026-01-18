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
    // Tests for hooks have been moved to @loro-extended/hooks-core
    // This package only contains React-specific bindings
  ],
  env: {
    NO_COLOR: "1",
  },
})
