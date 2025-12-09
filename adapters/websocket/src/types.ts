/**
 * Interface representing a WebSocket-like instance.
 * This interface captures the subset of the WebSocket API used by the WebSocketClientAdapter.
 */
export interface WebSocketLike {
  // Properties
  readyState: number
  binaryType: "arraybuffer" | "blob"

  // Methods
  send(data: string | ArrayBufferLike | Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: "open",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: "error",
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: "close",
    listener: (event: CloseEvent) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  removeEventListener(
    type: "open",
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: "error",
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: "close",
    listener: (event: CloseEvent) => void,
    options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
    options?: boolean | EventListenerOptions
  ): void
}

/**
 * Interface representing a WebSocket-like constructor.
 * This interface captures the constructor signature and static constants used by the WebSocketClientAdapter.
 */
export interface WebSocketConstructorLike<
  T extends WebSocketLike = WebSocketLike,
> {
  new (url: string): T

  // Static constants for connection state
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
}