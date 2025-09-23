import {
  configure,
  getJsonLinesFormatter,
  getAnsiColorFormatter,
  getConsoleSink,
  getLogger,
} from "@logtape/logtape"

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getJsonLinesFormatter() }),
    // stream: getStreamSink(stream.Writable.toWeb(process.stdout)),
  },
  loggers: [
    {
      category: ["@loro-extended", "repo"],
      lowestLevel: "trace",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
})

const logger = getLogger(["@loro-extended", "repo"])

logger.debug("hi", { data: true })
