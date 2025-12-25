/**
 * Fastify server for collaborative ProseMirror.
 *
 * Serves the Vite dev server in development and static files in production.
 * Handles WebSocket connections for loro-extended sync.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fastifyCors from "@fastify/cors"
import middie from "@fastify/middie"
import fastifyStatic from "@fastify/static"
import fastifyWebsocket from "@fastify/websocket"
import { configure, getConsoleSink } from "@logtape/logtape"
import Fastify from "fastify"
import { createServer as createViteServer, type ViteDevServer } from "vite"
import { repo } from "./repo.js"
import { registerWsRoutes } from "./ws-router.js"

// Configure logtape for server-side logging
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "../..")
const isProd = process.env.NODE_ENV === "production"
const PORT = Number(process.env.PORT) || 5173

async function main() {
  const app = Fastify({ logger: true })

  // Register CORS
  await app.register(fastifyCors)

  // Register WebSocket support FIRST
  await app.register(fastifyWebsocket)

  // Register WebSocket routes for loro-extended BEFORE Vite middleware
  // This ensures WebSocket upgrades are handled by Fastify, not Vite
  await registerWsRoutes(app, { path: "/ws" })

  // Register middie for Vite middleware compatibility
  await app.register(middie)

  // Vite middleware in dev (AFTER WebSocket routes)
  let vite: ViteDevServer | undefined
  if (!isProd) {
    vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: "custom",
    })
    app.use(vite.middlewares)
  }

  // In production, serve the built client files
  if (isProd) {
    await app.register(fastifyStatic, {
      root: path.resolve(root, "dist"),
      prefix: "/",
      decorateReply: false,
    })
  }

  // HTML route with Vite transform
  app.get("/", async (request, reply) => {
    const url = request.raw.url || "/"

    // Read index.html
    const htmlPath = isProd
      ? path.join(root, "dist", "index.html")
      : path.join(root, "index.html")

    let html = await fs.readFile(htmlPath, "utf-8")

    // Apply Vite HTML transforms in dev mode
    if (!isProd && vite) {
      html = await vite.transformIndexHtml(url, html)
    }

    return reply.type("text/html").send(html)
  })

  // Catch-all route for SPA - serve index.html for all non-API routes
  app.setNotFoundHandler(async (request, reply) => {
    // Don't serve HTML for WebSocket routes
    if (request.url.startsWith("/ws")) {
      return reply.status(404).send({ error: "Not found" })
    }

    // For SPA routes, serve index.html
    const htmlPath = isProd
      ? path.join(root, "dist", "index.html")
      : path.join(root, "index.html")

    let html = await fs.readFile(htmlPath, "utf-8")

    if (!isProd && vite) {
      html = await vite.transformIndexHtml(request.url, html)
    }

    return reply.type("text/html").send(html)
  })

  await app.listen({ port: PORT, host: "0.0.0.0" })

  console.log(`\n🚀 Collaborative ProseMirror Server`)
  console.log(`   Local:   http://localhost:${PORT}`)
  console.log(`   Mode:    ${isProd ? "production" : "development"}`)
  console.log(`   PeerID:  ${repo.identity.peerId}`)
  console.log()

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down server...")
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
