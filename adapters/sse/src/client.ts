/**
 * SSE client network adapter for loro-extended.
 *
 * This adapter uses:
 * - HTTP POST with binary CBOR encoding for client→server messages
 * - Server-Sent Events (SSE) with JSON for server→client messages
 *
 * The asymmetry is because SSE is a text-only protocol, so server responses
 * must be JSON. POST requests can be binary, providing ~33% bandwidth savings
 * on binary-heavy payloads.
 *
 * ## Wire Format
 *
 * POST requests use binary CBOR with transport-layer prefixes:
 * - `Content-Type: application/octet-stream`
 * - Messages are wrapped with MESSAGE_COMPLETE (0x00) prefix
 * - Large messages (>80KB) are fragmented into multiple POST requests
 *
 * ## Fragmentation
 *
 * The default fragment threshold is 80KB, providing a safety margin below
 * the typical 100KB body-parser limit. Each fragment is sent as a separate
 * POST request.
 */

import {
  Adapter,
  type Channel,
  type ChannelMsg,
  deserializeChannelMsg,
  type GeneratedChannel,
  type PeerID,
} from "@loro-extended/repo"
import {
  encodeFrame,
  fragmentPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"
import ReconnectingEventSource from "reconnecting-eventsource"

/**
 * Default fragment threshold in bytes.
 * Messages larger than this are fragmented into multiple POST requests.
 * 80KB provides a safety margin below the typical 100KB body-parser limit.
 */
export const DEFAULT_FRAGMENT_THRESHOLD = 80 * 1024

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
  /**
   * Fragment threshold in bytes. Messages larger than this are fragmented
   * into multiple POST requests.
   * Set to 0 to disable fragmentation (not recommended).
   * Default: 80KB (safe for typical 100KB body-parser limits)
   */
  fragmentThreshold?: number
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
  private readonly fragmentThreshold: number
  private currentRetryAbortController?: AbortController
  private listeners = new Set<(state: ConnectionState) => void>()

  constructor({
    postUrl,
    eventSourceUrl,
    reconnect,
    postRetry,
    fragmentThreshold,
  }: SseClientOptions) {
    super({ adapterType: "sse-client" })
    // Store the URL templates - we'll resolve them in onStart() when we have the peerId
    this.postUrl = postUrl
    this.eventSourceUrl = eventSourceUrl
    this.fragmentThreshold = fragmentThreshold ?? DEFAULT_FRAGMENT_THRESHOLD
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

    // SSE receives JSON messages (SSE is text-only)
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

        // Encode to binary CBOR wire format
        const frame = encodeFrame(msg)

        // Fragment large payloads for body-parser compatibility
        if (
          this.fragmentThreshold > 0 &&
          frame.length > this.fragmentThreshold
        ) {
          // Send fragments as separate POST requests
          const fragments = fragmentPayload(frame, this.fragmentThreshold)
          for (const fragment of fragments) {
            await this.sendBinaryWithRetry(resolvedPostUrl, fragment)
          }
        } else {
          // Wrap with MESSAGE_COMPLETE prefix for transport layer consistency
          await this.sendBinaryWithRetry(
            resolvedPostUrl,
            wrapCompleteMessage(frame),
          )
        }
      },
      stop: () => {
        this.eventSource?.close()
        this.eventSource = undefined
        this.currentRetryAbortController?.abort()
      },
    }
  }

  /**
   * Send binary data via POST with retry logic.
   */
  private async sendBinaryWithRetry(
    url: string,
    data: Uint8Array,
  ): Promise<void> {
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
            "Content-Type": "application/octet-stream",
            "X-Peer-Id": this.peerId,
          },
          // Use Blob for consistent fetch body handling across environments
          // Type assertion needed for strict DOM types that don't accept Uint8Array directly
          body: new Blob([data as BlobPart], {
            type: "application/octet-stream",
          }),
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
      } catch (error: unknown) {
        attempt++

        const err = error as Error

        // If aborted, stop retrying and rethrow
        if (err.name === "AbortError") {
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
