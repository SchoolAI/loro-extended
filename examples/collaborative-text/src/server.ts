import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// 1. Create loro-extended repo with WebSocket adapter
const wsAdapter = new WsServerNetworkAdapter()
new Repo({ adapters: [wsAdapter] })

// 2. Create HTTP server
const httpServer = http.createServer()

// 3. Create Vite dev server in middleware mode
const vite = await createViteServer({
  root,
  server: {
    middlewareMode: {
      server: httpServer,
    },
  },
})

// 4. Use Vite middleware for HTTP requests
httpServer.on("request", (req, res) => {
  vite.middlewares(req, res)
})

// 5. Create WebSocket server attached to HTTP server
new WebSocketServer({ server: httpServer, path: "/ws" }).on(
  "connection",
  ws => {
    const { start } = wsAdapter.handleConnection({
      socket: wrapWsSocket(ws),
    })
    start()
  },
)

// 6. Start listening
const port = Number(process.env.PORT) || 5173
httpServer.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`)
})
