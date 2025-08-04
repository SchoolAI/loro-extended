import Emittery from "emittery";
import type { Request, Response, Router } from "express";
import express from "express";
import type {
  RepoMessage,
  PeerId,
  NetworkAdapter,
  PeerMetadata,
} from "@loro-extended/repo";

// The events that our adapter will emit for the Repo's NetworkSubsystem to hear.
type AdapterEvents = {
  message: RepoMessage;
  "peer-candidate": { peerId: PeerId; metadata: PeerMetadata };
  "peer-disconnected": { peerId: PeerId };
};

export class SseServerNetworkAdapter
  extends Emittery<AdapterEvents>
  implements NetworkAdapter
{
  peerId?: PeerId;
  #clients = new Map<PeerId, Response>();

  constructor() {
    super();
  }

  //
  // NetworkAdapter implementation
  //

  connect(peerId: PeerId, _metadata: PeerMetadata): void {
    this.peerId = peerId;
    // In this adapter, connection is managed by the Express app listening,
    // so this is largely a no-op, but we store the peerId.
  }

  disconnect(): void {
    // Close all active client connections
    this.#clients.forEach(res => {
      res.end();
    });
    this.#clients.clear();
    this.peerId = undefined;
    console.log("SSE-ADAPTER: Disconnected and all clients removed.");
  }

  /** The NetworkSubsystem will call this method to send a message to a peer. */
  public send(message: RepoMessage): void {
    const clientRes = this.#clients.get(message.targetId);
    if (clientRes) {
      clientRes.write(`data: ${JSON.stringify(message)}\n\n`);
    } else {
      // It's possible for the network subsystem to try sending to a peer that
      // just disconnected, so a warning is appropriate.
      console.warn(
        `SSE-ADAPTER: Tried to send message to disconnected peer ${message.targetId}`,
      );
    }
  }

  //
  // Express Integration
  //

  /** Returns an Express Router to be mounted on the main app. */
  public getExpressRouter(): Router {
    const router = express.Router();

    // Endpoint for clients to send messages TO the server.
    router.post("/sync", (req, res) => {
      const message = req.body as RepoMessage;

      // Emit a "message" event, which the NetworkSubsystem is listening for.
      // This is how incoming messages get into the Repo.
      this.emit("message", message);

      res.status(200).send({ ok: true });
    });

    // Endpoint for clients to connect and listen for events FROM the server.
    router.get("/events", (req, res) => {
      this.#setupSseConnection(req, res);
    });

    return router;
  }

  #setupSseConnection(req: Request, res: Response) {
    // Set headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const peerId = req.query.peerId as PeerId;
    if (!peerId) {
      res.status(400).end("peerId query parameter is required");
      return;
    }

    // Store the client's response object to send events later
    this.#clients.set(peerId, res);
    console.log(`SSE-ADAPTER: Peer ${peerId} connected. Total clients: ${this.#clients.size}`);

    // Emit a "peer-candidate" event to inform the Repo a new peer is available.
    this.emit("peer-candidate", { peerId, metadata: {} });

    // Handle client disconnect
    req.on("close", () => {
      console.log(`SSE-ADAPTER: Peer ${peerId} disconnected.`);
      this.#clients.delete(peerId);
      // Emit a "peer-disconnected" event
      this.emit("peer-disconnected", { peerId });
    });
  }
}