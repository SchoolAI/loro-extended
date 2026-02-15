// Track startup time from the very beginning
const SERVER_START_TIME = Date.now()
const startupLog = (message: string) => {
  const elapsed = Date.now() - SERVER_START_TIME
  console.log(`[+${elapsed}ms] ${message}`)
}

startupLog("Server module loading...")

import { createServer, type IncomingMessage } from "node:http"
import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb/server"
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server"
import { type PeerID, Repo, sync } from "@loro-extended/repo"
import cors from "cors"
import express from "express"
import { WebSocketServer } from "ws"
import {
  ARENA_DOC_ID,
  ArenaSchema,
  GameEphemeralDeclarations,
  type ServerPresence,
} from "../shared/types.js"
import { logger } from "./config.js"
import { GameLoop } from "./game-loop.js"

startupLog("Imports complete, LogTape configured")

const app = express()
app.use(cors())
app.use(express.json())

// Request logging middleware
app.use((req, _res, next) => {
  logger.info`${req.method} ${req.url}`
  next()
})

startupLog("Express app created")

// Create adapters
const wsAdapter = new WsServerNetworkAdapter()

const storageAdapter = new LevelDBStorageAdapter("loro-bumper-cars.db")

// Create Repo
const repo = new Repo({
  identity: { name: "bumper-cars-server", type: "service" },
  adapters: [wsAdapter, storageAdapter],
})

logger.info`Repo created with peerId: ${repo.identity.peerId}`

// Get or create the arena document with typed schemas
// This provides type-safe access to both document and presence data
const arenaDoc = repo.get(ARENA_DOC_ID, ArenaSchema, GameEphemeralDeclarations)

// Create game loop with the typed doc - uses sync() for presence access
const gameLoop = new GameLoop(arenaDoc)

// Start game loop
gameLoop.start()

// Create HTTP + WebSocket server
const server = createServer(app)

const wss = new WebSocketServer({ server, path: "/ws" })

// Log when WebSocket upgrade requests arrive (before connection is established)
server.on("upgrade", (request: IncomingMessage, _socket, _head) => {
  const url = request.url || "unknown"
  logger.info`WebSocket upgrade request received for: ${url}`
})

wss.on("connection", (ws, req) => {
  if (!req.url) {
    throw new Error(`request URL is required`)
  }
  const url = new URL(req.url, `http://${req.headers.host}`)
  const peerId = url.searchParams.get("peerId")

  logger.info`WebSocket connection from peerId: ${peerId}`

  const { start } = wsAdapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId as PeerID | undefined,
  })

  start()
})

// Health check endpoint
app.get("/health", (_req, res) => {
  // Access server presence through sync()
  const serverPresence = sync(arenaDoc).presence.self as ServerPresence
  res.json({
    status: "ok",
    connections: wss.clients.size,
    tick: serverPresence?.tick ?? 0,
    cars: Object.keys(serverPresence?.cars ?? {}).length,
  })
})

const PORT = process.env.PORT || 5170
startupLog(`Starting to listen on port ${PORT}...`)
server.listen(PORT, () => {
  startupLog(`Server listening on port ${PORT}`)
  console.log(`🎪 Bumper Cars server listening on http://localhost:${PORT}`)
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws`)
  startupLog("Server fully ready to accept connections")
})

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info`Shutting down...`
  gameLoop.stop()
  server.close()
})
