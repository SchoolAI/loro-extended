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

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export interface SseClientOptions {
  postUrl: string | ((peerId: PeerID) => string)
  eventSourceUrl: string | ((peerId: PeerID) => string)
  reconnect?: {
    maxAttempts?: number // default: 10
    maxRetryTime?: number // passed to ReconnectingEventSource, default: 30000
  }
  postRetry?: {
    maxAttempts?: number // default: 3
    baseDelay?: number // default: 1000ms
    maxDelay?: number // default: 10000ms
  }
}

export class SseClientNetworkAdapter extends Adapter<void> {
  private peerId?: PeerID
  private postUrl: string | ((peerId: PeerID) => string)
  private eventSourceUrl: string | ((peerId: PeerID) => string)
  private serverChannel?: Channel
  private eventSource?: ReconnectingEventSource
  private isReconnecting = false

  public connectionState: ConnectionState = "disconnected"
  public reconnectAttempts = 0
  public maxReconnectAttempts = 10

  private postRetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
  }
  private currentRetryAbortController?: AbortController
  private listeners = new Set<(state: ConnectionState) => void>()

  constructor({
    postUrl,
    eventSourceUrl,
    reconnect,
    postRetry,
  }: SseClientOptions) {
    super({ adapterType: "sse-client" })
    // Store the URL templates - we'll resolve them in onStart() when we have the peerId
    this.postUrl = postUrl
    this.eventSourceUrl = eventSourceUrl
    if (reconnect?.maxAttempts !== undefined) {
      this.maxReconnectAttempts = reconnect.maxAttempts
    }
    if (postRetry) {
      this.postRetryOptions = { ...this.postRetryOptions, ...postRetry }
    }
  }

  /**
   * Subscribe to connection state changes.
   * @param listener Callback function that receives the new state
   * @returns Unsubscribe function
   */
  public subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    // Emit current state immediately
    listener(this.connectionState)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setConnectionState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state
      for (const listener of this.listeners) {
        listener(state)
      }
    }
  }

  /**
   * Reconnect the SSE connection.
   * This closes the existing EventSource and creates a new one.
   */
  private reconnect(): void {
    if (this.isReconnecting) {
      this.logger.debug("Already reconnecting, skipping")
      return
    }

    this.isReconnecting = true
    this.setConnectionState("reconnecting")
    this.logger.info("Reconnecting SSE connection...")

    // Close existing EventSource
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = undefined
    }

    // Create new EventSource (onopen will handle channel creation)
    this.setupEventSource()
    // setupEventSource sets state to 'connecting', but since this is a reconnect,
    // we want to stay in 'reconnecting' state until open
    this.setConnectionState("reconnecting")
    this.isReconnecting = false
  }

  /**
   * Set up the EventSource with all event handlers.
   */
  private setupEventSource(): void {
    if (!this.peerId) {
      throw new Error("Cannot setup EventSource: peerId not available")
    }

    this.setConnectionState("connecting")

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
      this.reconnectAttempts++
      this.setConnectionState("reconnecting")

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.logger.error("Max reconnect attempts reached, disconnecting")
        if (this.serverChannel) {
          this.removeChannel(this.serverChannel.channelId)
          this.serverChannel = undefined
        }
        this.setConnectionState("disconnected")
        this.eventSource?.close()
      }
    }

    this.eventSource.onopen = () => {
      this.logger.debug("SSE connection established")
      this.setConnectionState("connected")
      this.reconnectAttempts = 0

      // Cancel any pending retries
      if (this.currentRetryAbortController) {
        this.currentRetryAbortController.abort()
        this.currentRetryAbortController = undefined
      }

      // Only create a new channel if one doesn't exist
      if (!this.serverChannel) {
        this.serverChannel = this.addChannel()
      }

      // Always establish the channel on reconnect to ensure sync
      this.establishChannel(this.serverChannel.channelId)
    }
  }

  protected generate(): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: async (msg: ChannelMsg) => {
        if (!this.peerId) {
          throw new Error("Adapter not initialized - peerId not available")
        }

        // Check if EventSource is closed before sending
        // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
        if (this.eventSource?.readyState === 2) {
          this.logger.warn("EventSource is closed, triggering reconnection")
          this.reconnect()
          // Don't throw - the message will be lost, but reconnection will re-sync
          return
        }

        // Resolve the postUrl with the peerId
        const resolvedPostUrl =
          typeof this.postUrl === "function"
            ? this.postUrl(this.peerId)
            : this.postUrl

        // Serialize and send via HTTP POST
        const serialized = serializeChannelMsg(msg)

        await this.sendWithRetry(resolvedPostUrl, serialized)
      },
      stop: () => {
        this.eventSource?.close()
        this.eventSource = undefined
        this.currentRetryAbortController?.abort()
      },
    }
  }

  private async sendWithRetry(url: string, data: any): Promise<void> {
    let attempt = 0
    const { maxAttempts, baseDelay, maxDelay } = this.postRetryOptions

    while (attempt < maxAttempts) {
      try {
        // Create a new AbortController for this request if one doesn't exist
        // This allows us to cancel the retry loop if the connection resets
        if (!this.currentRetryAbortController) {
          this.currentRetryAbortController = new AbortController()
        }

        if (!this.peerId) {
          throw new Error("PeerID not available for retry")
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Peer-Id": this.peerId,
          },
          body: JSON.stringify(data),
          signal: this.currentRetryAbortController.signal,
        })

        if (!response.ok) {
          // Don't retry on client errors (4xx), except maybe 429 (Too Many Requests)
          // For now, we'll assume 4xx are fatal
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`Failed to send message: ${response.statusText}`)
          }
          throw new Error(`Server error: ${response.statusText}`)
        }

        // Success
        this.currentRetryAbortController = undefined
        return
      } catch (error: any) {
        attempt++

        // If aborted, stop retrying and rethrow
        if (error.name === "AbortError") {
          throw error
        }

        // If controller was cleared (e.g. by onopen), stop retrying
        if (!this.currentRetryAbortController) {
          const abortError = new Error("Retry aborted by connection reset")
          abortError.name = "AbortError"
          throw abortError
        }

        // If max attempts reached, throw the last error
        if (attempt >= maxAttempts) {
          this.currentRetryAbortController = undefined
          throw error
        }

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          baseDelay * 2 ** (attempt - 1) + Math.random() * 100,
          maxDelay,
        )

        // Wait for delay or abort signal
        await new Promise<void>((resolve, reject) => {
          if (this.currentRetryAbortController?.signal.aborted) {
            const error = new Error("Retry aborted")
            error.name = "AbortError"
            reject(error)
            return
          }

          const timer = setTimeout(() => {
            resolve()
            cleanup()
          }, delay)

          const onAbort = () => {
            clearTimeout(timer)
            const error = new Error("Retry aborted")
            error.name = "AbortError"
            reject(error)
            cleanup()
          }

          const cleanup = () => {
            this.currentRetryAbortController?.signal.removeEventListener(
              "abort",
              onAbort,
            )
          }

          this.currentRetryAbortController?.signal.addEventListener(
            "abort",
            onAbort,
          )
        })
      }
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
    this.setupEventSource()
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
