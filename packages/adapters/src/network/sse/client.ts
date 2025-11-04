import {
  Adapter,
  type BaseChannel,
  type Channel,
  type ChannelMsg,
  type PeerId,
} from "@loro-extended/repo"
import ReconnectingEventSource from "reconnecting-eventsource"
import { v4 as uuid } from "uuid"

export class SseClientNetworkAdapter extends Adapter<void> {
  private peerId: PeerId
  private postUrl: string
  private eventSourceUrl: string
  private serverChannel?: Channel
  private eventSource?: ReconnectingEventSource

  constructor({
    postUrl,
    eventSourceUrl,
  }: {
    postUrl: string | ((peerId: PeerId) => string)
    eventSourceUrl: string | ((peerId: PeerId) => string)
  }) {
    super({ adapterId: "sse-client" })
    this.peerId = uuid() // Generate unique peer ID for self

    this.postUrl =
      typeof postUrl === "function" ? postUrl(this.peerId) : postUrl
    this.eventSourceUrl =
      typeof eventSourceUrl === "function"
        ? eventSourceUrl(this.peerId)
        : eventSourceUrl
  }

  protected generate(): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: async (msg: ChannelMsg) => {
        // Serialize and send via HTTP POST
        const response = await fetch(this.postUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Peer-Id": this.peerId, // Include peerId in header
          },
          body: JSON.stringify(msg),
        })

        if (!response.ok) {
          throw new Error(`Failed to send message: ${response.statusText}`)
        }
      },
      start: receive => {
        this.eventSource = new ReconnectingEventSource(this.eventSourceUrl)

        this.eventSource.onmessage = event => {
          const message = JSON.parse(event.data)

          // Send to channel via receive function
          receive(message)
        }

        this.eventSource.onerror = err => {
          this.logger.warn("SSE connection error", { error: err })
          // Connection will auto-reconnect via ReconnectingEventSource
        }

        this.eventSource.onopen = () => {
          this.logger.debug("SSE connection established")
        }
      },
      stop: () => {
        this.eventSource?.close()
        this.eventSource = undefined
      },
    }
  }

  onBeforeStart({ addChannel }: { addChannel: () => Channel }) {
    // Create single channel for server connection
    this.serverChannel = addChannel()
  }

  onStart() {}

  onAfterStop() {}
}
