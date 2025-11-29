import fs from "node:fs"
import stream from "node:stream"
import { configure, getConsoleSink, getStreamSink } from "@logtape/logtape"

const LOG_PIPE_PATH = "./log.jsonl"

const logPipeStream = fs.createWriteStream(LOG_PIPE_PATH, { flags: "w" })

// Configure LogTape for tests
await configure({
  sinks: {
    console: getConsoleSink(),
    file: getStreamSink(stream.Writable.toWeb(logPipeStream)),
  },
  loggers: [
    {
      category: [],
      lowestLevel: "trace",
      sinks: ["file"],
      filters: ["channel"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],

  filters: {
    channel: record => {
      const message = record.message[0]
      if (!message || typeof message !== "string") return false
      return (
        message.startsWith("channel/") ||
        message.startsWith("synchronizer/") ||
        record.properties.debug === true
      )
    },
  },
})
