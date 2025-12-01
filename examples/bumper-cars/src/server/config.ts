import { configure, getConsoleSink, getLogger } from "@logtape/logtape"

// Configure LogTape
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
    {
      category: ["bumper-cars"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
  ],
})

export const logger = getLogger(["bumper-cars", "server"])
