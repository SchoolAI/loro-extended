import {
  type NetMsg,
  NetworkAdapter,
  type PeerId,
  type PeerMetadata,
} from "@loro-extended/repo"
import ReconnectingEventSource from "reconnecting-eventsource"

/*

In the case of a server:


*/

export class SseClientNetworkAdapter extends NetworkAdapter {
  peerId?: PeerId
  #serverUrl: string
  #eventSource?: ReconnectingEventSource

  constructor(serverUrl: string) {
    super()
    this.#serverUrl = serverUrl
  }

  async start(peerId: PeerId, _metadata: PeerMetadata): Promise<void> {
    this.peerId = peerId
    const url = `${this.#serverUrl}/events?peerId=${peerId}`
    this.#eventSource = new ReconnectingEventSource(url)

    this.#eventSource.onmessage = event => {
      const serializedMessage = JSON.parse(event.data)
      const message = this.#deserializeMessage(serializedMessage) as NetMsg
      this.messageReceived(message)
    }

    this.#eventSource.onerror = err => {
      console.warn("disconnected", err)
      this.peerDisconnected("server")
    }

    // When we connect, we can treat the server as a peer.
    this.peerAvailable("server", {})
  }

  async stop(): Promise<void> {
    this.#eventSource?.close()
    this.peerDisconnected("server")
    this.peerId = undefined
  }

  async send(message: NetMsg): Promise<void> {
    // Convert Uint8Array to base64 for JSON serialization
    const serializedMessage = this.#serializeMessage(message)
    const response = await fetch(`${this.#serverUrl}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serializedMessage),
    })

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`)
    }
  }

  #serializeMessage(message: any): any {
    if (message && typeof message === "object") {
      if (message instanceof Uint8Array) {
        // Convert Uint8Array to base64
        const base64 = btoa(String.fromCharCode(...message))
        return {
          __type: "Uint8Array",
          data: base64,
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
        const binaryString = atob(message.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        return bytes
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
