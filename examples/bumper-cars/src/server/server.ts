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
import { type PeerID, Repo } from "@loro-extended/repo"
import cors from "cors"
import express from "express"
import { WebSocketServer } from "ws"
import {
  ARENA_DOC_ID,
  type GamePresence,
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
startupLog("Creating WsServerNetworkAdapter...")
const wsAdapter = new WsServerNetworkAdapter()
startupLog("WsServerNetworkAdapter created")

startupLog("Creating LevelDBStorageAdapter...")
const storageAdapter = new LevelDBStorageAdapter("loro-bumper-cars.db")
startupLog("LevelDBStorageAdapter created")

// Create Repo
startupLog("Creating Repo...")
const repo = new Repo({
  identity: { name: "bumper-cars-server", type: "service" },
  adapters: [wsAdapter, storageAdapter],
})
startupLog(`Repo created with peerId: ${repo.identity.peerId}`)

logger.info`Repo created with peerId: ${repo.identity.peerId}`

// Get or create the arena document
const arenaHandle = repo.get(ARENA_DOC_ID)

// Server presence state
let serverPresence: ServerPresence

// Create game loop
const gameLoop = new GameLoop(
  arenaHandle,
  () => {
    // Get all presence from the handle
    return arenaHandle.untypedPresence.all as Record<string, GamePresence>
  },
  (presence: ServerPresence) => {
    serverPresence = presence
    arenaHandle.untypedPresence.set(presence)
  },
)

// Start game loop
startupLog("Starting game loop...")
gameLoop.start()
startupLog("Game loop started")

// Create HTTP + WebSocket server
startupLog("Creating HTTP server...")
const server = createServer(app)
startupLog("HTTP server created")

startupLog("Creating WebSocketServer...")
const wss = new WebSocketServer({ server, path: "/ws" })
startupLog("WebSocketServer created")

// Log when WebSocket upgrade requests arrive (before connection is established)
server.on("upgrade", (request: IncomingMessage, _socket, _head) => {
  const url = request.url || "unknown"
  startupLog(`WebSocket upgrade request received for: ${url}`)
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
  res.json({
    status: "ok",
    connections: wss.clients.size,
    tick: serverPresence.tick,
    cars: Object.keys(serverPresence.cars).length,
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
