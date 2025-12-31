import {
  type BunWsData,
  createBunWebSocketHandlers,
} from "@loro-extended/adapter-websocket/bun"
import { WsServerNetworkAdapter } from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"

const wsAdapter = new WsServerNetworkAdapter()
new Repo({ adapters: [wsAdapter] })

// Build the app using HTML entrypoint - Bun auto-discovers and bundles JS/CSS
const result = await Bun.build({
  entrypoints: ["./public/index.html"],
  outdir: "./dist",
})
if (!result.success) throw new AggregateError(result.logs, "Build failed")

Bun.serve<BunWsData>({
  port: 5173,
  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { handlers: {} } })) return
      return new Response("Upgrade failed", { status: 400 })
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname
    const file = Bun.file(`./dist${pathname}`)
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 })
  },
  websocket: createBunWebSocketHandlers(wsAdapter),
})

console.log(`🚀 Server running at http://localhost:5173`)
