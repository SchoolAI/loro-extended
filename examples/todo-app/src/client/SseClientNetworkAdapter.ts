import Emittery from "emittery";
import type {
  RepoMessage,
  PeerId,
  NetworkAdapter,
  PeerMetadata,
} from "@loro-extended/repo";

type AdapterEvents = {
  message: RepoMessage;
  "peer-candidate": { peerId: PeerId; metadata: PeerMetadata };
  "peer-disconnected": { peerId: PeerId };
};

export class SseClientNetworkAdapter
  extends Emittery<AdapterEvents>
  implements NetworkAdapter
{
  peerId?: PeerId;
  #serverUrl: string;
  #eventSource?: EventSource;

  constructor(serverUrl: string) {
    super();
    this.#serverUrl = serverUrl;
  }

  connect(peerId: PeerId, _metadata: PeerMetadata): void {
    this.peerId = peerId;
    const url = `${this.#serverUrl}/events?peerId=${peerId}`;
    this.#eventSource = new EventSource(url);

    this.#eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data) as RepoMessage;
      this.emit("message", message);
    };

    this.#eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      // The server will emit a "peer-disconnected" event on its end,
      // but we can also signal it here.
      this.emit("peer-disconnected", { peerId: "server" });
    };

    // When we connect, we can treat the server as a peer.
    this.emit("peer-candidate", { peerId: "server", metadata: {} });
  }

  disconnect(): void {
    this.#eventSource?.close();
    this.emit("peer-disconnected", { peerId: "server" });
    this.peerId = undefined;
  }

  async send(message: RepoMessage): Promise<void> {
    try {
      const response = await fetch(`${this.#serverUrl}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }
}