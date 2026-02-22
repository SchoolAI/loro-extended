/**
 * HTTP Polling client network adapter for loro-extended.
 *
 * This adapter uses:
 * - HTTP POST with binary CBOR encoding for client→server messages
 * - HTTP GET with JSON for server→client messages (poll responses)
 *
 * The asymmetry is because poll responses aggregate queued messages and
 * benefit from simple JSON serialization, while POST requests can use
 * binary encoding for ~33% bandwidth savings on binary-heavy payloads.
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

export interface HttpPollingClientOptions {
  /**
   * URL for polling (GET requests).
   * Can be a string or a function that receives the peerId and returns the URL.
   * The URL should include the peerId as a query parameter.
   *
   * @example
   * pollUrl: (peerId) => `/api/poll?peerId=${peerId}`
   */
  pollUrl: string | ((peerId: PeerID) => string)

  /**
   * URL for sending messages (POST requests).
   * Can be a string or a function that receives the peerId and returns the URL.
   *
   * @example
   * postUrl: () => `/api/sync`
   */
  postUrl: string | ((peerId: PeerID) => string)

  /**
   * Retry options for POST requests.
   */
  postRetry?: {
    maxAttempts?: number // default: 3
    baseDelay?: number // default: 1000ms
    maxDelay?: number // default: 10000ms
  }

  /**
   * How long to ask the server to wait for messages (hint, not guarantee).
   * Server may return sooner due to: messages available, infra timeout, server config.
   * Set to 0 for regular polling behavior (server returns immediately).
   *
   * @default 30000 (30 seconds)
   */
  serverWaitHint?: number

  /**
   * Minimum time between poll requests (prevents hammering on errors/cuts).
   * This acts as a rate limiter when errors occur.
   *
   * @default 100 (100ms)
   */
  minPollInterval?: number

  /**
   * Optional delay after successful response before re-polling.
   * Set to 0 for immediate re-poll (real-time feel with long-polling).
   * Set to a higher value for battery-friendly regular polling.
   *
   * @default 0 (immediate re-poll)
   */
  pollDelay?: number

  /**
   * Fragment threshold in bytes. Messages larger than this are fragmented
   * into multiple POST requests.
   * Set to 0 to disable fragmentation (not recommended).
   * Default: 80KB (safe for typical 100KB body-parser limits)
   */
  fragmentThreshold?: number

  /**
   * Optional fetch options (headers, credentials, etc.).
   * These will be merged with the default options for each request.
   */
  fetchOptions?: RequestInit
}

/**
 * HTTP Polling client network adapter.
 *
 * This adapter connects to a server using HTTP polling with optional long-polling support.
 * It's resilient to infrastructure limitations - if long-polling connections are cut short,
 * it gracefully degrades to regular polling behavior.
 *
 * @example
 * ```typescript
 * const adapter = new HttpPollingClientNetworkAdapter({
 *   pollUrl: (peerId) => `/api/poll?peerId=${peerId}`,
 *   postUrl: () => `/api/sync`,
 *   serverWaitHint: 30000,  // Ask server to wait up to 30s
 *   minPollInterval: 100,   // Rate limit on errors
 *   pollDelay: 0,           // Immediate re-poll
 * })
 *
 * const repo = new Repo({
 *   identity: { name: "client", type: "user" },
 *   adapters: [adapter]
 * })
 * ```
 */
export class HttpPollingClientNetworkAdapter extends Adapter<void> {
  private peerId?: PeerID
  private pollUrl: string | ((peerId: PeerID) => string)
  private postUrl: string | ((peerId: PeerID) => string)
  private serverWaitHint: number
  private minPollInterval: number
  private pollDelay: number
  private fetchOptions?: RequestInit
  private postRetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
  }
  private readonly fragmentThreshold: number

  private serverChannel?: Channel
  private isPolling = false
  private shouldStop = false
  private pollAbortController?: AbortController
  public connectionState: ConnectionState = "disconnected"
  private listeners = new Set<(state: ConnectionState) => void>()

  constructor(options: HttpPollingClientOptions) {
    super({ adapterType: "http-polling-client" })
    this.pollUrl = options.pollUrl
    this.postUrl = options.postUrl
    this.serverWaitHint = options.serverWaitHint ?? 30000
    this.minPollInterval = options.minPollInterval ?? 100
    this.pollDelay = options.pollDelay ?? 0
    this.fetchOptions = options.fetchOptions
    this.fragmentThreshold =
      options.fragmentThreshold ?? DEFAULT_FRAGMENT_THRESHOLD
    if (options.postRetry) {
      this.postRetryOptions = { ...this.postRetryOptions, ...options.postRetry }
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
        this.stopPolling()
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

    // Start the polling loop
    this.startPolling()
  }

  async onStop(): Promise<void> {
    this.stopPolling()
    this.setConnectionState("disconnected")

    if (this.serverChannel) {
      this.removeChannel(this.serverChannel.channelId)
      this.serverChannel = undefined
    }
  }

  /**
   * Start the polling loop.
   */
  private startPolling(): void {
    if (this.isPolling) {
      return
    }

    this.isPolling = true
    this.shouldStop = false
    this.setConnectionState("connecting")
    this.pollLoop()
  }

  /**
   * Stop the polling loop.
   */
  private stopPolling(): void {
    this.shouldStop = true
    this.isPolling = false

    // Abort any in-flight poll request
    if (this.pollAbortController) {
      this.pollAbortController.abort()
      this.pollAbortController = undefined
    }
  }

  /**
   * The main polling loop.
   * Uses async/await instead of setInterval for better control.
   */
  private async pollLoop(): Promise<void> {
    while (!this.shouldStop) {
      const startTime = Date.now()
      let success = false

      try {
        await this.poll()
        success = true
        this.setConnectionState("connected")
      } catch (error) {
        // Log error but continue polling
        if (!this.shouldStop) {
          this.logger.warn("Poll error", { error })
          this.setConnectionState("reconnecting")
        }
      }

      if (this.shouldStop) {
        break
      }

      // Calculate delay before next poll
      const elapsed = Date.now() - startTime
      let delay: number

      if (success) {
        // Successful poll - use configured pollDelay
        delay = this.pollDelay
      } else {
        // Error - use minPollInterval to prevent hammering
        delay = Math.max(0, this.minPollInterval - elapsed)
      }

      if (delay > 0) {
        await this.sleep(delay)
      }
    }
  }

  /**
   * Perform a single poll request.
   */
  private async poll(): Promise<void> {
    if (!this.peerId) {
      throw new Error("peerId not available")
    }

    // Build poll URL with wait parameter
    let resolvedPollUrl =
      typeof this.pollUrl === "function"
        ? this.pollUrl(this.peerId)
        : this.pollUrl

    // Add wait parameter for long-polling
    if (this.serverWaitHint > 0) {
      const separator = resolvedPollUrl.includes("?") ? "&" : "?"
      resolvedPollUrl += `${separator}wait=${this.serverWaitHint}`
    }

    // Create abort controller for this request
    this.pollAbortController = new AbortController()

    const response = await fetch(resolvedPollUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...this.fetchOptions?.headers,
      },
      signal: this.pollAbortController.signal,
      ...this.fetchOptions,
    })

    this.pollAbortController = undefined

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.statusText}`)
    }

    const data = await response.json()
    const { messages, isNewConnection } = data as {
      messages: unknown[]
      isNewConnection?: boolean
    }

    // On first successful poll (new connection), create channel and establish
    if (isNewConnection && !this.serverChannel) {
      this.serverChannel = this.addChannel()
      this.establishChannel(this.serverChannel.channelId)
      this.logger.debug("Connection established via polling")
    }

    // Process received messages
    if (this.serverChannel && messages && messages.length > 0) {
      for (const serialized of messages) {
        try {
          const message = deserializeChannelMsg(serialized as any)
          this.serverChannel.onReceive(message)
        } catch (error) {
          this.logger.warn("Failed to deserialize message", { error })
        }
      }
    }
  }

  /**
   * Sleep for the specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
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
        if (!this.peerId) {
          throw new Error("PeerID not available for retry")
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Peer-Id": this.peerId,
            ...this.fetchOptions?.headers,
          },
          // Use Blob for consistent fetch body handling across environments
          body: new Blob([data as BlobPart], {
            type: "application/octet-stream",
          }),
          ...this.fetchOptions,
        })

        if (!response.ok) {
          // Don't retry on client errors (4xx) - they won't succeed on retry
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`Failed to send message: ${response.statusText}`)
          }
          // Server errors (5xx) will be caught and retried below
          throw new Error(`Server error: ${response.statusText}`)
        }

        // Success
        return
      } catch (error: unknown) {
        // Check if this is a client error (4xx) - don't retry those
        if (
          error instanceof Error &&
          error.message.startsWith("Failed to send message:")
        ) {
          throw error
        }

        attempt++

        // If max attempts reached, throw the last error
        if (attempt >= maxAttempts) {
          throw error
        }

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          baseDelay * 2 ** (attempt - 1) + Math.random() * 100,
          maxDelay,
        )

        await this.sleep(delay)
      }
    }
  }
}
