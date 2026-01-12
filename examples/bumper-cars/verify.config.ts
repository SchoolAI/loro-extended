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
      reportingDependsOn: ["format"],
      children: [
        {
          key: "types:app",
          run: "./node_modules/.bin/tsgo --noEmit --skipLibCheck -p tsconfig.app.json",
          parser: "tsc",
        },
        {
          key: "types:node",
          run: "./node_modules/.bin/tsgo --noEmit --skipLibCheck -p tsconfig.node.json",
          parser: "tsc",
        },
      ],
    },
  ],
})
