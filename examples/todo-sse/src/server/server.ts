import { configure, getConsoleSink } from "@logtape/logtape"
import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import {
  createSseExpressRouter,
  SseServerNetworkAdapter,
} from "@loro-extended/adapter-sse/express"
import { Repo } from "@loro-extended/repo"
import cors from "cors"
import express from "express"

// Configure LogTape for server-side logging
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug", // Set to "debug" or "trace" for verbose logging
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
})

console.log("Server LogTape configured")

const app = express()
app.use(cors())
app.use(express.json())

// Add request logging middleware
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  if (req.method === "POST" && req.url.includes("/sync")) {
    console.log("POST body:", JSON.stringify(req.body).substring(0, 200))
  }
  next()
})

// 1. Create the adapter instances.
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-todo-app.db")

// 2. Create the Repo, passing the adapters in the config.
// The repo is not directly used, but its constructor sets up the listeners
// between the network and storage adapters.
new Repo({
  identity: { name: "todo-app-server", type: "service" },
  adapters: [sseAdapter, storageAdapter],
})

// 3. Create and mount the SSE Express router under the "/loro" prefix.
app.use(
  "/loro",
  createSseExpressRouter(sseAdapter, {
    syncPath: "/sync",
    eventsPath: "/events",
    heartbeatInterval: 30000,
  }),
)

const PORT = process.env.PORT || 8001
app.listen(PORT, () => {
  console.log(
    `Loro-Extended Todo App Server listening on http://localhost:${PORT}`,
  )
})
