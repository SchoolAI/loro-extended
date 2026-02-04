/**
 * RPS Demo Server
 *
 * This server demonstrates LEA 4.0's World + Worldview architecture:
 * - Creates a Repo with WebSocket adapter for sync
 * - Creates a LEA runtime with filtering and reactors
 * - Filters ensure players can only modify their own data
 * - Reactors handle game logic (all locked → reveal → resolved)
 */

import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server"
import { getTransition, loro } from "@loro-extended/change"
import { createLens } from "@loro-extended/lens"
import { Repo } from "@loro-extended/repo"
import { createServer as createViteServer } from "vite"
import type { WebSocket } from "ws"
import { WebSocketServer } from "ws"
import { createIdentityMessage, SERVER_PLAYER_ID } from "../shared/identity.js"
import {
  type GameChangeFn,
  type GameDocShape,
  GameSchema,
} from "../shared/schema.js"
import { makeGameFilter } from "./filters.js"
import { allLockedReactor, resolveGameReactor } from "./reactors.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// ═══════════════════════════════════════════════════════════════════════════
// Server-side LEA Runtime
// ═══════════════════════════════════════════════════════════════════════════
// The server runs a LEA runtime with:
// - Identity extraction from commit messages
// - Filtering to validate player actions
// - Reactors for game logic

// 1. Create loro-extended repo with WebSocket adapter
const wsAdapter = new WsServerNetworkAdapter()
const repo = new Repo({ adapters: [wsAdapter] })

// 2. Get handle for game document
const handle = repo.get("rps-game", GameSchema)

handle.subscribe(event => {
  console.log("handle.doc subscribe event", event)
})

// 3. Create Lens attached to Repo's doc
// The lens will filter world imports into its worldview
const gameFilter = makeGameFilter(handle.doc)
const lens = createLens<GameDocShape>(handle.doc, { filter: gameFilter })

function changeAsServer(fn: GameChangeFn) {
  lens.change(fn, { commitMessage: createIdentityMessage(SERVER_PLAYER_ID) })
}

const unsubscribe = loro(lens.worldview).subscribe(event => {
  console.log("subscribe event", event)

  if (event.by === "checkout") return

  const { before, after } = getTransition(lens.worldview, event)

  console.dir({ before: before.toJSON() }, { depth: null })
  console.dir({ after: after.toJSON() }, { depth: null })

  allLockedReactor({ before, after }, changeAsServer)

  resolveGameReactor({ before, after }, changeAsServer)
})

// 4. Initialize game state
changeAsServer(d => {
  d.game.players.set("alice", { choice: null, locked: false })
  d.game.players.set("bob", { choice: null, locked: false })
})

console.log(
  "[lea-server] Lens + subscribe runtime started with World/Worldview filtering",
)
console.log("[lea-server] Game initialized with players: alice, bob")

// Log world state for debugging
const worldDoc = loro(lens.world)
console.log("[lea-server] World peer ID:", worldDoc.peerIdStr)

// ═══════════════════════════════════════════════════════════════════════════
// HTTP + WebSocket Server
// ═══════════════════════════════════════════════════════════════════════════

// 5. Create HTTP server
const httpServer = http.createServer()

// 6. Track Vite readiness and queue pending WebSocket connections
let viteReady = false
const pendingConnections: WebSocket[] = []
const serverStartTime = Date.now()

function handleWsConnection(ws: WebSocket) {
  const elapsed = Date.now() - serverStartTime

  console.log(`[loro-ws] WebSocket connection handled after ${elapsed}ms`)

  const { start } = wsAdapter.handleConnection({
    socket: wrapWsSocket(ws),
  })

  start()
}

function processPendingConnections() {
  if (pendingConnections.length > 0) {
    console.log(
      `[loro-ws] Processing ${pendingConnections.length} pending WebSocket connections`,
    )
    for (const ws of pendingConnections) {
      handleWsConnection(ws)
    }
    pendingConnections.length = 0
  }
}

// 7. Create Vite dev server in middleware mode
const vite = await createViteServer({
  root,
  server: {
    middlewareMode: {
      server: httpServer,
    },
  },
})

// 8. Mark Vite as ready
viteReady = true
const viteReadyTime = Date.now() - serverStartTime
console.log(`[vite] Vite server created after ${viteReadyTime}ms`)

// 9. Use Vite middleware for HTTP requests
httpServer.on("request", (req, res) => {
  vite.middlewares(req, res)
})

// 10. Create WebSocket server attached to HTTP server
new WebSocketServer({ server: httpServer, path: "/ws" }).on(
  "connection",
  ws => {
    const elapsed = Date.now() - serverStartTime
    console.log(
      `[loro-ws] WebSocket connection received after ${elapsed}ms, viteReady=${viteReady}`,
    )

    if (viteReady) {
      handleWsConnection(ws)
    } else {
      console.log("[loro-ws] Queueing WebSocket connection until Vite is ready")
      pendingConnections.push(ws)
    }
  },
)

// 11. Cleanup on process exit
process.on("SIGINT", () => {
  console.log("[lea-server] Shutting down...")
  unsubscribe()
  lens.dispose()
  process.exit(0)
})

// 12. Start listening
const port = Number(process.env.PORT) || 5173
httpServer.listen(port, () => {
  const elapsed = Date.now() - serverStartTime
  console.log(
    `🚀 RPS Demo running at http://localhost:${port} (started in ${elapsed}ms)`,
  )
  console.log(`   Open two browser tabs:`)
  console.log(`   - Alice: http://localhost:${port}?player=alice`)
  console.log(`   - Bob:   http://localhost:${port}?player=bob`)
  // Process any connections that arrived during startup
  processPendingConnections()
})
