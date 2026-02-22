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
    // Visibility controls DISCOVERY (can this peer learn a document exists?),
    // not DATA TRANSFER. Once a peer subscribes via sync-request, they receive
    // all updates regardless of visibility (the "visibility bypass").
    //
    // Returning `true` here means the server will:
    // - Include documents in the initial sync list when a client connects
    // - Announce new documents to clients who haven't subscribed yet
    //
    // Returning `false` would NOT block sync-requests or subscribed updates,
    // but would prevent the server from proactively telling clients about
    // documents they don't already know about.
    visibility(_doc, peer) {
      if (peer.channelKind === "storage") return true
      return true
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
