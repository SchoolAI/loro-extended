import { SseServerNetworkAdapter } from "@loro-extended/adapters/network/sse/server"
import {
  deserializeChannelMsg,
  type PeerID,
  Repo,
  serializeChannelMsg,
} from "@loro-extended/repo"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

// Create the SSE adapter
const sseAdapter = new SseServerNetworkAdapter()

// Create server-side Repo instance with proper identity and adapters
new Repo({
  identity: { name: "hono-counter-server", type: "service" },
  adapters: [sseAdapter],
})

const app = new Hono()

// API routes
const routes = app
  // Example traditional API endpoint
  .get("/api/clock", c => {
    return c.json({
      time: new Date().toLocaleTimeString(),
    })
  })

  // SSE endpoint for Loro sync - client subscribes here
  .get("/sync/subscribe", async c => {
    const peerId = c.req.query("peerId") as PeerID | undefined
    if (!peerId) {
      return c.json({ error: "peerId is required" }, 400)
    }

    return streamSSE(c, async stream => {
      // IMPORTANT: Send initial event to trigger client's EventSource.onopen event
      await stream.writeSSE({ data: "connected", event: "open" })

      // Register connection with the adapter
      const connection = sseAdapter.registerConnection(peerId)

      // Set up send function to write to SSE stream
      connection.setSendFunction(message => {
        const serialized = serializeChannelMsg(message)
        stream.writeSSE({
          data: JSON.stringify(serialized),
        })
      })

      // Keep connection alive with periodic heartbeats
      const heartbeatInterval = setInterval(() => {
        try {
          stream.writeSSE({
            data: "",
            event: "heartbeat",
          })
        } catch {
          // Stream closed
          clearInterval(heartbeatInterval)
        }
      }, 30000)

      // Handle stream close
      stream.onAbort(() => {
        clearInterval(heartbeatInterval)
        sseAdapter.unregisterConnection(peerId)
      })

      // Keep the stream open indefinitely
      await new Promise(() => {})
    })
  })

  // POST endpoint for client to send messages
  .post("/sync/post", async c => {
    const peerId = c.req.header("x-peer-id") as PeerID | undefined
    if (!peerId) {
      return c.json({ error: "x-peer-id header is required" }, 400)
    }

    const serialized = await c.req.json()
    const message = deserializeChannelMsg(serialized)
    const connection = sseAdapter.getConnection(peerId)

    if (!connection) {
      return c.json({ error: "Connection not found. Subscribe first." }, 404)
    }

    connection.receive(message)
    return c.json({ ok: true })
  })

export type AppType = typeof routes

app.get("/", c => {
  return c.html(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <link
          rel="stylesheet"
          href="https://cdn.simplecss.org/simple.min.css"
        />
        {import.meta.env.PROD ? (
          <script type="module" src="/static/client.js" />
        ) : (
          <script type="module" src="/src/client.tsx" />
        )}
      </head>
      <body>
        <div id="root" />
      </body>
    </html>,
  )
})

export default app
