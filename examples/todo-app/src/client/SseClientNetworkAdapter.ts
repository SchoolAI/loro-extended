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
      const serializedMessage = JSON.parse(event.data);
      const message = this.#deserializeMessage(serializedMessage) as RepoMessage;
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
      // Convert Uint8Array to base64 for JSON serialization
      const serializedMessage = this.#serializeMessage(message);
      const response = await fetch(`${this.#serverUrl}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serializedMessage),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }

  #serializeMessage(message: any): any {
    if (message && typeof message === 'object') {
      if (message instanceof Uint8Array) {
        // Convert Uint8Array to base64
        const base64 = btoa(String.fromCharCode(...message));
        return {
          __type: 'Uint8Array',
          data: base64
        };
      } else if (Array.isArray(message)) {
        return message.map(item => this.#serializeMessage(item));
      } else {
        const result: any = {};
        for (const key in message) {
          result[key] = this.#serializeMessage(message[key]);
        }
        return result;
      }
    }
    return message;
  }

  #deserializeMessage(message: any): any {
    if (message && typeof message === 'object') {
      if (message.__type === 'Uint8Array' && message.data) {
        // Convert base64 back to Uint8Array
        const binaryString = atob(message.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      } else if (Array.isArray(message)) {
        return message.map(item => this.#deserializeMessage(item));
      } else {
        const result: any = {};
        for (const key in message) {
          result[key] = this.#deserializeMessage(message[key]);
        }
        return result;
      }
    }
    return message;
  }
}