import {
  Adapter,
  type Channel,
  type ChannelMsg,
  deserializeChannelMsg,
  type GeneratedChannel,
  type PeerID,
  serializeChannelMsg,
} from "@loro-extended/repo"
import ReconnectingEventSource from "reconnecting-eventsource"

export class SseClientNetworkAdapter extends Adapter<void> {
  private peerId?: PeerID
  private postUrl: string | ((peerId: PeerID) => string)
  private eventSourceUrl: string | ((peerId: PeerID) => string)
  private serverChannel?: Channel
  private eventSource?: ReconnectingEventSource

  constructor({
    postUrl,
    eventSourceUrl,
  }: {
    postUrl: string | ((peerId: PeerID) => string)
    eventSourceUrl: string | ((peerId: PeerID) => string)
  }) {
    super({ adapterType: "sse-client" })
    // Store the URL templates - we'll resolve them in onStart() when we have the peerId
    this.postUrl = postUrl
    this.eventSourceUrl = eventSourceUrl
  }

  protected generate(): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: async (msg: ChannelMsg) => {
        if (!this.peerId) {
          throw new Error("Adapter not initialized - peerId not available")
        }

        // Resolve the postUrl with the peerId
        const resolvedPostUrl =
          typeof this.postUrl === "function"
            ? this.postUrl(this.peerId)
            : this.postUrl

        // Serialize and send via HTTP POST
        const serialized = serializeChannelMsg(msg)
        const response = await fetch(resolvedPostUrl, {
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
      stop: () => {
        this.eventSource?.close()
        this.eventSource = undefined
      },
    }
  }

  async onStart(): Promise<void> {
    // Get the peerId from the identity (set during _initialize)
    if (!this.identity) {
      throw new Error(
        "Adapter not properly initialized - identity not available",
      )
    }
    this.peerId = this.identity.peerId

    // Resolve the eventSourceUrl with the peerId
    const resolvedEventSourceUrl =
      typeof this.eventSourceUrl === "function"
        ? this.eventSourceUrl(this.peerId)
        : this.eventSourceUrl

    this.eventSource = new ReconnectingEventSource(resolvedEventSourceUrl)

    this.eventSource.onmessage = event => {
      if (!this.serverChannel) {
        this.logger.warn("Received message but server channel is not available")
        return
      }
      const serialized = JSON.parse(event.data)
      const message = deserializeChannelMsg(serialized)
      this.serverChannel.onReceive(message)
    }

    this.eventSource.onerror = (_err: Event) => {
      this.logger.warn("SSE connection error")
      if (this.serverChannel) {
        this.removeChannel(this.serverChannel.channelId)
        this.serverChannel = undefined
      }
    }

    this.eventSource.onopen = () => {
      this.logger.debug("SSE connection established")

      // If we have an existing channel, remove it first to ensure a fresh handshake
      if (this.serverChannel) {
        this.removeChannel(this.serverChannel.channelId)
        this.serverChannel = undefined
      }

      this.serverChannel = this.addChannel()

      this.establishChannel(this.serverChannel.channelId)
    }
  }

  async onStop(): Promise<void> {
    this.eventSource?.close()
    this.eventSource = undefined

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }
  }
}
