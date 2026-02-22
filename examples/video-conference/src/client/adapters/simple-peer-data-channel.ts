import type Peer from "simple-peer"

/**
 * Custom error event that includes the error info.
 * Used to forward simple-peer errors through the RTCDataChannel interface.
 */
export interface ErrorEventWithError extends Event {
  error?: Error
}

/**
 * Wraps a simple-peer instance to look like an RTCDataChannel.
 * This allows the WebRTC adapter to use simple-peer's built-in data channel
 * without needing to create a separate (and conflicting) data channel.
 *
 * ## Why this exists
 *
 * simple-peer creates its own RTCDataChannel internally, but the loro-extended
 * WebRTC adapter expects to receive an RTCDataChannel to attach to. Rather than
 * creating a second data channel (which would conflict), we wrap the simple-peer
 * instance to expose the same interface.
 *
 * ## Event forwarding
 *
 * - simple-peer `connect` → RTCDataChannel `open`
 * - simple-peer `close` → RTCDataChannel `close`
 * - simple-peer `error` → RTCDataChannel `error`
 * - simple-peer `data` → RTCDataChannel `message`
 */
export class SimplePeerDataChannelWrapper implements Partial<RTCDataChannel> {
  private peer: Peer.Instance
  private _onopen: ((ev: Event) => void) | null = null
  private _onclose: ((ev: Event) => void) | null = null
  private _onerror: ((ev: Event) => void) | null = null
  private _onmessage: ((ev: MessageEvent) => void) | null = null

  constructor(peer: Peer.Instance) {
    this.peer = peer

    // Forward simple-peer events to data channel events
    peer.on("connect", () => {
      if (this._onopen) {
        this._onopen(new Event("open"))
      }
      this.dispatchEvent(new Event("open"))
    })

    peer.on("close", () => {
      if (this._onclose) {
        this._onclose(new Event("close"))
      }
      this.dispatchEvent(new Event("close"))
    })

    peer.on("error", (err: Error) => {
      if (this._onerror) {
        // Create a custom error event that includes the error info
        const event: ErrorEventWithError = new Event("error")
        event.error = err
        this._onerror(event)
      }
      this.dispatchEvent(new Event("error"))
    })

    peer.on("data", (data: Uint8Array | string) => {
      if (this._onmessage) {
        this._onmessage(new MessageEvent("message", { data }))
      }
      this.dispatchEvent(new MessageEvent("message", { data }))
    })
  }

  // RTCDataChannel properties
  get label(): string {
    return "simple-peer-wrapper"
  }

  get readyState(): RTCDataChannelState {
    return this.peer.connected ? "open" : "connecting"
  }

  // Event handlers
  set onopen(handler: ((ev: Event) => void) | null) {
    this._onopen = handler
  }
  get onopen(): ((ev: Event) => void) | null {
    return this._onopen
  }

  set onclose(handler: ((ev: Event) => void) | null) {
    this._onclose = handler
  }
  get onclose(): ((ev: Event) => void) | null {
    return this._onclose
  }

  set onerror(handler: ((ev: Event) => void) | null) {
    this._onerror = handler
  }
  get onerror(): ((ev: Event) => void) | null {
    return this._onerror
  }

  set onmessage(handler: ((ev: MessageEvent) => void) | null) {
    this._onmessage = handler
  }
  get onmessage(): ((ev: MessageEvent) => void) | null {
    return this._onmessage
  }

  // Methods
  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    // simple-peer's send accepts string | ArrayBuffer | ArrayBufferView
    // Blob is not directly supported, so we pass it through and let simple-peer handle it
    this.peer.send(data as Parameters<Peer.Instance["send"]>[0])
  }

  close(): void {
    // We don't want to close the peer connection here, just detach
    // The peer lifecycle is managed by the usePeerManager hook
  }

  // EventTarget implementation (minimal)
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    // We handle the main events via the setters above or direct peer events
    // This is a simplified implementation for the adapter's needs
    if (type === "open" && typeof listener === "function") {
      this._onopen = listener as (ev: Event) => void
    } else if (type === "close" && typeof listener === "function") {
      this._onclose = listener as (ev: Event) => void
    } else if (type === "error" && typeof listener === "function") {
      this._onerror = listener as (ev: Event) => void
    } else if (type === "message" && typeof listener === "function") {
      this._onmessage = listener as (ev: MessageEvent) => void
    }
  }

  removeEventListener(
    type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions,
  ): void {
    if (type === "open") this._onopen = null
    else if (type === "close") this._onclose = null
    else if (type === "error") this._onerror = null
    else if (type === "message") this._onmessage = null
  }

  dispatchEvent(_event: Event): boolean {
    return true
  }
}
