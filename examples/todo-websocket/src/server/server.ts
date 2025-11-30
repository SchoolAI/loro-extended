import { configure, getConsoleSink } from "@logtape/logtape"
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server"
import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import { Repo, type PeerID } from "@loro-extended/repo"
import cors from "cors"
import express from "express"
import { createServer } from "node:http"
import { WebSocketServer } from "ws"

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
  next()
})

// 1. Create the adapter instances.
const wsAdapter = new WsServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-todo-websocket-app.db")

// 2. Create the Repo, passing the adapters in the config.
// The repo is not directly used, but its constructor sets up the listeners
// between the network and storage adapters.
new Repo({
  identity: { name: "todo-websocket-server", type: "service" },
  adapters: [wsAdapter, storageAdapter],
})

// 3. Create HTTP server and WebSocket server
const server = createServer(app)
const wss = new WebSocketServer({ server, path: "/ws" })

// 4. Handle WebSocket connections
wss.on("connection", (ws, req) => {
  // Extract peerId from query string
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const peerId = url.searchParams.get("peerId")

  console.log(`WebSocket connection from peerId: ${peerId}`)

  const { start } = wsAdapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId as PeerID | undefined,
  })

  start()
})

const PORT = process.env.PORT || 5170
server.listen(PORT, () => {
  console.log(
    `Loro-Extended Todo WebSocket App Server listening on http://localhost:${PORT}`,
  )
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`)
})