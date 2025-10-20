import {
  Adapter,
  type BaseChannel,
  type Channel,
  type ChannelId,
  type ChannelMsg,
  type PeerId,
  type ReceiveFn,
} from "@loro-extended/repo"
import ReconnectingEventSource from "reconnecting-eventsource"
import { v4 as uuid } from "uuid"

export class SseClientNetworkAdapter extends Adapter<void> {
  private peerId: PeerId
  private serverUrl: string
  private serverChannel?: Channel
  private receive?: ReceiveFn
  private eventSource?: ReconnectingEventSource

  constructor(serverUrl: string) {
    super({ adapterId: "sse-client" })
    this.peerId = uuid() // Generate unique peer ID
    this.serverUrl = serverUrl
  }

  protected generate(): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: async (msg: ChannelMsg) => {
        // Serialize and send via HTTP POST
        const serialized = this.#serializeMessage(msg)
        const response = await fetch(`${this.serverUrl}/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Peer-Id": this.peerId, // Include peerId in header
          },
          body: JSON.stringify(serialized),
        })

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.statusText}`)
        }
      },
      start: (receive) => {
        this.receive = receive
      },
      stop: () => {
        this.receive = undefined
      },
    }
  }

  init({ addChannel }: { addChannel: (context: void) => Channel }) {
    // Create single channel for server connection
    this.serverChannel = addChannel()
  }

  deinit() {
    this.eventSource?.close()
    this.eventSource = undefined
    this.serverChannel = undefined
    this.receive = undefined
  }

  start() {
    // Connect to server with peerId
    const url = `${this.serverUrl}/events?peerId=${this.peerId}`
    this.eventSource = new ReconnectingEventSource(url)

    this.eventSource.onmessage = (event) => {
      const serialized = JSON.parse(event.data)
      const message = this.#deserializeMessage(serialized) as ChannelMsg

      // Send to channel via receive function
      this.receive?.(message)
    }

    this.eventSource.onerror = (err) => {
      this.logger.warn("SSE connection error", { error: err })
      // Connection will auto-reconnect via ReconnectingEventSource
    }

    this.eventSource.onopen = () => {
      this.logger.debug("SSE connection established")
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
        const binaryString = atob(message.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        return bytes
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
