import { createServer } from "node:http"
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
  EmptyServerPresence,
  type GamePresence,
  type ServerPresence,
} from "../shared/types.js"
import { logger } from "./config.js"
import { GameLoop } from "./game-loop.js"

const app = express()
app.use(cors())
app.use(express.json())

// Request logging middleware
app.use((req, _res, next) => {
  logger.info`${req.method} ${req.url}`
  next()
})

// Create adapters
const wsAdapter = new WsServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-bumper-cars.db")

// Create Repo
const repo = new Repo({
  identity: { name: "bumper-cars-server", type: "service" },
  adapters: [wsAdapter, storageAdapter],
})

logger.info`Repo created with peerId: ${repo.identity.peerId}`

// Get or create the arena document
const arenaHandle = repo.get(ARENA_DOC_ID)

// Server presence state
let serverPresence: ServerPresence = EmptyServerPresence

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
gameLoop.start()

// Create HTTP + WebSocket server
const server = createServer(app)
const wss = new WebSocketServer({ server, path: "/ws" })

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
server.listen(PORT, () => {
  console.log(`🎪 Bumper Cars server listening on http://localhost:${PORT}`)
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info`Shutting down...`
  gameLoop.stop()
  server.close()
})
