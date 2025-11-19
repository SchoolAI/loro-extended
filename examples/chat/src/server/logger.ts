import { configure, getConsoleSink, getLogger } from "@logtape/logtape"

export async function configureLogger() {
  // Configure LogTape for server-side logging
  await configure({
    sinks: { console: getConsoleSink() },
    filters: {},
    loggers: [
      {
        category: [],
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

  const logger = getLogger()

  logger.debug`Logger configured`

  return logger
}
