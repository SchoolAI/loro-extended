import { configure, getConsoleSink, getLogger } from "@logtape/logtape"

export async function configureLogger() {
  await configure({
    sinks: { console: getConsoleSink() },
    filters: {},
    loggers: [
      {
        category: ["@loro-extended"],
        lowestLevel: "info",
        sinks: ["console"],
      },
      {
        category: ["video-conference"],
        lowestLevel: "debug",
        sinks: ["console"],
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  })

  return getLogger(["video-conference"])
}
