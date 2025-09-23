import { NetworkAdapter, type ChannelMsg, type PeerId } from "@loro-extended/repo"
import type { Request, Response, Router } from "express"
import express from "express"

export class SseServerNetworkAdapter extends NetworkAdapter {
  #clients = new Map<PeerId, Response>()
  #heartbeats = new Map<PeerId, NodeJS.Timeout>()
  #heartbeatInterval = 30000 // 30 seconds

  //
  // NetworkAdapter implementation
  //

  async start() {
    console.info("[SSE-ADAPTER] Started")
  }

  async stop(): Promise<void> {
    // Close all active client connections
    this.#clients.forEach(res => {
      res.end()
    })
    // Clear all heartbeats
    this.#heartbeats.forEach(timeout => {
      clearTimeout(timeout)
    })
    this.#heartbeats.clear()
    this.#clients.clear()
    console.log("[SSE-ADAPTER] Disconnected and all clients removed")
  }

  /** The NetworkSubsystem will call this method to send a message to a peer. */
  async send(message: ChannelMsg): Promise<void> {
    for (const targetId of message.targetIds) {
      const clientRes = this.#clients.get(targetId)
      if (clientRes) {
        // Convert Uint8Array to base64 for JSON serialization
        const serializedMessage = this.#serializeMessage(message)
        clientRes.write(`data: ${JSON.stringify(serializedMessage)}\n\n`)
      } else {
        // It's possible for the network subsystem to try sending to a peer that
        // just disconnected, so a warning is appropriate.
        console.warn(
          `[SSE-ADAPTER] Tried to send message to disconnected peer ${targetId}`,
        )
      }
    }
  }

  //
  // Express Integration
  //

  /** Returns an Express Router to be mounted on the main app. */
  public getExpressRouter(): Router {
    const router = express.Router()

    // Endpoint for clients to send messages TO the server.
    router.post("/sync", (req, res) => {
      const serializedMessage = req.body
      const message = this.#deserializeMessage(serializedMessage) as ChannelMsg

      // Forward the message to the repo
      this.messageReceived(message)

      res.status(200).send({ ok: true })
    })

    // Endpoint for clients to connect and listen for events FROM the server.
    router.get("/events", (req, res) => {
      this.#setupSseConnection(req, res)
    })

    return router
  }

  #setupSseConnection(req: Request, res: Response) {
    // Set headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    res.flushHeaders()

    const peerId = req.query.peerId as PeerId
    if (!peerId) {
      res.status(400).end("peerId query parameter is required")
      return
    }

    // Store the client's response object to send events later
    this.#clients.set(peerId, res)

    console.log(
      `[SSE-ADAPTER] Connect peer: ${peerId}. Total peers: ${this.#clients.size}`,
    )

    // Tell the Repo about the new peer
    this.peerAvailable(peerId, {})

    // Setup heartbeat to detect stale connections
    this.#setupHeartbeat(peerId, res)

    // Handle client disconnect
    req.on("close", () => {
      this.#cleanupConnection(peerId)
      console.log(
        `[SSE-ADAPTER] Disconnect peer ${peerId}. Total peers: ${this.#clients.size}`,
      )
      // Emit a "peer-disconnected" event
      this.peerDisconnected(peerId)
    })
  }

  #setupHeartbeat(peerId: PeerId, res: Response) {
    // Clear any existing heartbeat for this peer
    const existingHeartbeat = this.#heartbeats.get(peerId)
    if (existingHeartbeat) {
      clearTimeout(existingHeartbeat)
    }

    // Setup new heartbeat
    const heartbeat = setInterval(() => {
      try {
        // Send a heartbeat comment (SSE comments are ignored by clients)
        res.write(": heartbeat\n\n")
      } catch (_) {
        // If we can't write to the response, the connection is dead
        this.#cleanupConnection(peerId)
        this.peerDisconnected(peerId)
      }
    }, this.#heartbeatInterval)

    this.#heartbeats.set(peerId, heartbeat)
  }

  #cleanupConnection(peerId: PeerId) {
    // Clear heartbeat
    const heartbeat = this.#heartbeats.get(peerId)
    if (heartbeat) {
      clearTimeout(heartbeat)
      this.#heartbeats.delete(peerId)
    }

    // Remove client
    this.#clients.delete(peerId)
  }

  #serializeMessage(message: any): any {
    if (message && typeof message === "object") {
      if (message instanceof Uint8Array) {
        // Convert Uint8Array to base64
        return {
          __type: "Uint8Array",
          data: Buffer.from(message).toString("base64"),
        }
      } else if (Array.isArray(message)) {
        return message.map(item => this.#serializeMessage(item))
      } else {
        const result: any = {}
        for (const key in message) {
          result[key] = this.#serializeMessage(message[key])
        }
        return result
      }
    }
    return message
  }

  #deserializeMessage(message: any): any {
    if (message && typeof message === "object") {
      if (message.__type === "Uint8Array" && message.data) {
        // Convert base64 back to Uint8Array
        return new Uint8Array(Buffer.from(message.data, "base64"))
      } else if (Array.isArray(message)) {
        return message.map(item => this.#deserializeMessage(item))
      } else {
        const result: any = {}
        for (const key in message) {
          result[key] = this.#deserializeMessage(message[key])
        }
        return result
      }
    }
    return message
  }
}
