import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import {
  createSseExpressRouter,
  SseServerNetworkAdapter,
} from "@loro-extended/adapter-sse/express"
import { Repo } from "@loro-extended/repo"
import cors from "cors"
import express from "express"
import { logger } from "./config.js"

const app = express()
app.use(cors())
app.use(express.json())

// Request logging middleware
app.use((req, _res, next) => {
  logger.info`${req.method} ${req.url}`
  next()
})

// Create the adapter instances
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-video-conference.db")

// Create the Repo
const repo = new Repo({
  identity: { name: "video-conference-server", type: "service" },
  adapters: [sseAdapter, storageAdapter],
  permissions: {
    visibility(_doc, peer) {
      // Storage adapters can always see documents
      if (peer.channelKind === "storage") return true

      // Network peers can only see room documents that they themselves reveal
      return false
    },
  },
})

logger.info`Repo created with peerId: ${repo.identity.peerId}`

// Create and mount the SSE Express router
app.use(
  "/loro",
  createSseExpressRouter(sseAdapter, {
    syncPath: "/sync",
    eventsPath: "/events",
    heartbeatInterval: 30000,
  }),
)

const PORT = process.env.PORT || 5171
app.listen(PORT, () => {
  console.log(`Video Conference Server listening on http://localhost:${PORT}`)
})
