import {
  Adapter,
  type BaseChannel,
  type Channel,
  type ChannelId,
  type ChannelMsg,
  type PeerId,
  type ReceiveFn,
} from "@loro-extended/repo"
import type { Request, Response, Router } from "express"
import express from "express"

export class SseServerNetworkAdapter extends Adapter<PeerId> {
  private clients = new Map<PeerId, Response>()
  private receiveFns = new Map<PeerId, ReceiveFn>()
  private heartbeats = new Map<PeerId, NodeJS.Timeout>()
  private channelsByPeer = new Map<PeerId, Channel>()
  private addChannel?: (context: PeerId) => Channel
  private removeChannel?: (channelId: ChannelId) => Channel | undefined
  private heartbeatInterval = 30000 // 30 seconds

  constructor() {
    super({ adapterId: "sse-server" })
  }

  protected generate(peerId: PeerId): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: async (msg: ChannelMsg) => {
        const clientRes = this.clients.get(peerId)
        if (clientRes) {
          const serialized = this.#serializeMessage(msg)
          clientRes.write(`data: ${JSON.stringify(serialized)}\n\n`)
        } else {
          this.logger.warn("Tried to send to disconnected peer", { peerId })
        }
      },
      start: (receive) => {
        // Store receive function for this peer
        this.receiveFns.set(peerId, receive)
      },
      stop: () => {
        // Cleanup receive function
        this.receiveFns.delete(peerId)
        this.#cleanupConnection(peerId)
      },
    }
  }

  onBeforeStart({
    addChannel,
    removeChannel,
  }: {
    addChannel: (context: PeerId) => Channel
    removeChannel: (channelId: ChannelId) => Channel | undefined
  }) {
    // Store callbacks for lazy channel creation
    this.addChannel = addChannel
    this.removeChannel = removeChannel
  }

  onAfterStop() {
    // Close all active client connections
    for (const [peerId, res] of this.clients) {
      res.end()
    }

    // Clear all heartbeats
    for (const timeout of this.heartbeats.values()) {
      clearTimeout(timeout)
    }

    // Clear all maps
    this.clients.clear()
    this.receiveFns.clear()
    this.heartbeats.clear()
    this.channelsByPeer.clear()

    this.logger.info("SSE server adapter deinitialized")
  }

  onStart() {
    // Nothing to do - server waits for connections
    this.logger.info("SSE server adapter started")
  }

  /** Returns an Express Router to be mounted on the main app. */
  public getExpressRouter(): Router {
    const router = express.Router()

    // Endpoint for clients to send messages TO the server
    router.post("/sync", (req, res) => {
      const serialized = req.body
      const message = this.#deserializeMessage(serialized) as ChannelMsg

      // Extract peerId from header or message
      const peerId = req.headers["x-peer-id"] as PeerId

      if (!peerId) {
        res.status(400).send({ error: "Missing X-Peer-Id header" })
        return
      }

      // Route to appropriate channel's receive function
      const receive = this.receiveFns.get(peerId)

      if (receive) {
        receive(message)
        res.status(200).send({ ok: true })
      } else {
        this.logger.warn("Received message from unknown peer", { peerId })
        res.status(404).send({ error: "Peer not connected" })
      }
    })

    // Endpoint for clients to connect and listen for events FROM the server
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

    // Lazy channel creation
    const channel = this.addChannel!(peerId)
    this.channelsByPeer.set(peerId, channel)
    this.clients.set(peerId, res)

    this.logger.info("Client connected", {
      peerId,
      channelId: channel.channelId,
      totalClients: this.clients.size,
    })

    // Setup heartbeat to detect stale connections
    this.#setupHeartbeat(peerId, res)

    // Handle client disconnect
    req.on("close", () => {
      this.logger.info("Client disconnected", {
        peerId,
        totalClients: this.clients.size - 1,
      })

      // Remove channel
      this.removeChannel!(channel.channelId)
      this.channelsByPeer.delete(peerId)
      this.#cleanupConnection(peerId)
    })
  }

  #setupHeartbeat(peerId: PeerId, res: Response) {
    // Clear any existing heartbeat for this peer
    const existingHeartbeat = this.heartbeats.get(peerId)
    if (existingHeartbeat) {
      clearTimeout(existingHeartbeat)
    }

    // Setup new heartbeat
    const heartbeat = setInterval(() => {
      try {
        // Send a heartbeat comment (SSE comments are ignored by clients)
        res.write(": heartbeat\n\n")
      } catch (err) {
        // If we can't write to the response, the connection is dead
        this.logger.warn("Heartbeat failed, cleaning up connection", { peerId })
        const channel = this.channelsByPeer.get(peerId)
        if (channel) {
          this.removeChannel!(channel.channelId)
        }
        this.channelsByPeer.delete(peerId)
        this.#cleanupConnection(peerId)
      }
    }, this.heartbeatInterval)

    this.heartbeats.set(peerId, heartbeat)
  }

  #cleanupConnection(peerId: PeerId) {
    // Clear heartbeat
    const heartbeat = this.heartbeats.get(peerId)
    if (heartbeat) {
      clearTimeout(heartbeat)
      this.heartbeats.delete(peerId)
    }

    // Remove client
    this.clients.delete(peerId)
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
        return message.map((item) => this.#serializeMessage(item))
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
        return message.map((item) => this.#deserializeMessage(item))
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
