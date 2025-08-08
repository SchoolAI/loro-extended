import type {
  NetworkAdapter,
  NetworkAdapterEvents,
  PeerId,
  PeerMetadata,
  RepoMessage,
} from "@loro-extended/repo"
import Emittery from "emittery"
import type { Request, Response, Router } from "express"
import express from "express"

export class SseServerNetworkAdapter
  extends Emittery<NetworkAdapterEvents>
  implements NetworkAdapter
{
  peerId?: PeerId
  #clients = new Map<PeerId, Response>()

  //
  // NetworkAdapter implementation
  //

  connect(peerId: PeerId, _metadata: PeerMetadata): void {
    this.peerId = peerId
    // In this adapter, connection is managed by the Express app listening,
    // so this is largely a no-op, but we store the peerId.
  }

  disconnect(): void {
    // Close all active client connections
    this.#clients.forEach(res => {
      res.end()
    })
    this.#clients.clear()
    this.peerId = undefined
    console.log("SSE-ADAPTER: Disconnected and all clients removed.")
  }

  /** The NetworkSubsystem will call this method to send a message to a peer. */
  public send(message: RepoMessage): void {
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
          `SSE-ADAPTER: Tried to send message to disconnected peer ${targetId}`,
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
      const message = this.#deserializeMessage(serializedMessage) as RepoMessage

      // Emit a "message" event, which the NetworkSubsystem is listening for.
      // This is how incoming messages get into the Repo.
      this.emit("message", message)

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
      `[SSE-ADAPTER] New Peer: ${peerId}. Total clients: ${this.#clients.size}`,
    )

    // Emit a "peer-candidate" event to inform the Repo a new peer is available.
    this.emit("peer-candidate", { peerId, metadata: {} })

    // Handle client disconnect
    req.on("close", () => {
      console.log(`SSE-ADAPTER: Peer ${peerId} disconnected.`)
      this.#clients.delete(peerId)
      // Emit a "peer-disconnected" event
      this.emit("peer-disconnected", { peerId })
    })
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
