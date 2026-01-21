import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"
import { createServer as createViteServer } from "vite"
import type { WebSocket } from "ws"
import { WebSocketServer } from "ws"
import { runtime } from "../shared/runtime.js"
import { DEFAULT_QUESTIONS, QuizDocSchema } from "../shared/schema.js"
import { createAiFeedbackReactor } from "./reactors.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// ═══════════════════════════════════════════════════════════════════════════
// Server-side LEA Program
// ═══════════════════════════════════════════════════════════════════════════
// The server runs its own LEA Program with just the AI feedback reactor.
// This ensures feedback is generated exactly once (on the server), not
// duplicated across multiple client tabs.

const QUIZ_DOC_ID = "demo-quiz"

// 1. Create loro-extended repo with WebSocket adapter
const wsAdapter = new WsServerNetworkAdapter()
const repo = new Repo({ adapters: [wsAdapter] })

// 2. Get handle to the quiz document and start server-side LEA Program
const handle = repo.get(QUIZ_DOC_ID, QuizDocSchema)

// Create the AI feedback reactor (this is the server's only reactor)
const aiFeedbackReactor = createAiFeedbackReactor(handle.doc, DEFAULT_QUESTIONS)

// Start the server-side LEA Program
const { dispose } = runtime({
  doc: handle.doc,
  questions: DEFAULT_QUESTIONS,
  reactors: [aiFeedbackReactor],
  done: () => console.log("[lea-server] Server-side LEA Program stopped"),
})

console.log(
  "[lea-server] Server-side LEA Program started with AI feedback reactor",
)

// Cleanup on process exit
process.on("SIGINT", () => {
  console.log("[lea-server] Shutting down...")
  dispose()
  process.exit(0)
})

// 2. Create HTTP server
const httpServer = http.createServer()

// 3. Track Vite readiness and queue pending WebSocket connections
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

// 4. Create Vite dev server in middleware mode
// The await here ensures Vite has finished its initial setup before we proceed
const vite = await createViteServer({
  root,
  server: {
    middlewareMode: {
      server: httpServer,
    },
  },
})

// 5. Mark Vite as ready after createViteServer completes
// The await above ensures Vite's initial module graph and transforms are ready
viteReady = true
const viteReadyTime = Date.now() - serverStartTime
console.log(`[vite] Vite server created after ${viteReadyTime}ms`)

// 6. Use Vite middleware for HTTP requests
httpServer.on("request", (req, res) => {
  vite.middlewares(req, res)
})

// 7. Create WebSocket server attached to HTTP server
// Queue connections until Vite is ready to avoid event loop blocking
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

// 8. Start listening
const port = Number(process.env.PORT) || 5173
httpServer.listen(port, () => {
  const elapsed = Date.now() - serverStartTime
  console.log(
    `🚀 Server running at http://localhost:${port} (started in ${elapsed}ms)`,
  )
  // Process any connections that arrived during startup
  processPendingConnections()
})
