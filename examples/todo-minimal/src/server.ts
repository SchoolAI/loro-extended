import {
  type BunWsData,
  wrapBunWebSocket,
} from "@loro-extended/adapter-websocket/bun"
import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"

const wsAdapter = new WsServerNetworkAdapter()
new Repo({ adapters: [wsAdapter] })

// Build the app to disk on startup
async function buildApp() {
  console.log("Building client...")

  const result = await Bun.build({
    entrypoints: ["./src/app.tsx"],
    outdir: "./dist",
  })

  if (!result.success) {
    console.error("Build failed:")
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error("Build failed")
  }

  console.log(
    "Build complete:",
    result.outputs.map(o => o.path),
  )
}

await buildApp()

const port = 5173

Bun.serve<BunWsData>({
  port,
  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === "/ws") {
      return server.upgrade(req, { data: { handlers: {} } })
        ? undefined
        : new Response("Upgrade failed", { status: 400 })
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(null, { status: 204 })
    }

    // Serve index.html for root
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"))
    }

    // Serve static files from dist/
    const file = Bun.file(`./dist${url.pathname}`)
    if (await file.exists()) {
      return new Response(file)
    }

    return new Response("Not found", { status: 404 })
  },
  websocket: {
    open(ws) {
      wsAdapter.handleConnection({ socket: wrapBunWebSocket(ws) }).start()
    },
    message(ws, msg) {
      const data = msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg
      ws.data.handlers.onMessage(data)
    },
    close(ws, code, reason) {
      ws.data.handlers.onClose(code, reason)
    },
  },
})

console.log(`🚀 Server running at http://localhost:${port}`)
