import type { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import type { PeerID } from "@loro-extended/repo"
import { useCallback, useRef, useState } from "react"
// Use the minified browser build to avoid Node.js polyfill issues
import Peer from "simple-peer/simplepeer.min.js"
import type { SignalData } from "../../shared/types"
import { ICE_SERVERS, shouldInitiate } from "../../shared/webrtc-protocol"

export type ConnectionState = "connecting" | "connected" | "failed"

export type PeerConnection = {
  peer: Peer.Instance
  stream: MediaStream | null
  connected: boolean
}

/**
 * Wraps a simple-peer instance to look like an RTCDataChannel.
 * This allows the WebRTC adapter to use simple-peer's built-in data channel
 * without needing to create a separate (and conflicting) data channel.
 */
class SimplePeerDataChannelWrapper implements Partial<RTCDataChannel> {
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

    peer.on("error", err => {
      if (this._onerror) {
        // Create a custom error event that includes the error info
        const event = new Event("error") as any
        event.error = err
        this._onerror(event)
      }
      this.dispatchEvent(new Event("error"))
    })

    peer.on("data", data => {
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
    this.peer.send(data as any)
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

export type UsePeerManagerOptions = {
  myPeerId: PeerID
  localStream: MediaStream | null
  onSignal: (targetPeerId: PeerID, signal: SignalData) => void
  /** Called when a peer connection is successfully established */
  onConnected?: (remotePeerId: PeerID) => void
  webrtcAdapter: WebRtcDataChannelAdapter
}

export type UsePeerManagerReturn = {
  /** Map of remote peer ID to their MediaStream */
  remoteStreams: Map<PeerID, MediaStream>
  /** Map of remote peer ID to connection state */
  connectionStates: Map<PeerID, ConnectionState>
  /** Create a new peer connection */
  createPeer: (remotePeerId: PeerID) => void
  /** Destroy a peer connection */
  destroyPeer: (remotePeerId: PeerID) => void
  /** Pass a signal to a peer */
  signalPeer: (remotePeerId: PeerID, signal: SignalData) => void
  /** Check if a peer connection exists */
  hasPeer: (remotePeerId: PeerID) => boolean
}

/**
 * Hook to manage WebRTC peer connections using simple-peer.
 *
 * This hook handles:
 * - Creating and destroying peer connections
 * - Managing connection states
 * - Collecting remote streams
 * - Forwarding signals to the appropriate peer
 *
 * It does NOT handle:
 * - Signal routing/deduplication (use useSignalChannel)
 * - Presence integration (handled by parent hook)
 * - Participant lifecycle (handled by parent hook)
 */
export function usePeerManager({
  myPeerId,
  localStream,
  onSignal,
  onConnected,
  webrtcAdapter,
}: UsePeerManagerOptions): UsePeerManagerReturn {
  // Map of peerId -> PeerConnection
  const peersRef = useRef<Map<PeerID, PeerConnection>>(new Map())

  // Remote streams for rendering
  const [remoteStreams, setRemoteStreams] = useState<Map<PeerID, MediaStream>>(
    new Map(),
  )

  // Connection states for UI
  const [connectionStates, setConnectionStates] = useState<
    Map<PeerID, ConnectionState>
  >(new Map())

  // Cleanup a peer connection
  const destroyPeer = useCallback(
    (remotePeerId: PeerID) => {
      const connection = peersRef.current.get(remotePeerId)
      if (connection) {
        // Detach Loro data channel before destroying peer
        webrtcAdapter.detachDataChannel(remotePeerId)
        connection.peer.destroy()
        peersRef.current.delete(remotePeerId)
        setRemoteStreams(prev => {
          const next = new Map(prev)
          next.delete(remotePeerId)
          return next
        })
        setConnectionStates(prev => {
          const next = new Map(prev)
          next.delete(remotePeerId)
          return next
        })
      }
    },
    [webrtcAdapter],
  )

  // Create a peer connection for a remote participant
  const createPeer = useCallback(
    (remotePeerId: PeerID) => {
      if (peersRef.current.has(remotePeerId)) {
        return
      }

      // Deterministic initiator: numerically smaller peerId initiates
      const isInitiator = shouldInitiate(myPeerId, remotePeerId)

      const peer = new Peer({
        initiator: isInitiator,
        stream: localStream || undefined,
        trickle: true,
        config: { iceServers: ICE_SERVERS },
      })

      const connection: PeerConnection = {
        peer,
        stream: null,
        connected: false,
      }

      peersRef.current.set(remotePeerId, connection)
      setConnectionStates(prev => new Map(prev).set(remotePeerId, "connecting"))

      // Attach the simple-peer instance to the Loro adapter using our wrapper
      // This allows Loro to use simple-peer's built-in data channel
      const dataChannelWrapper = new SimplePeerDataChannelWrapper(
        peer,
      ) as unknown as RTCDataChannel
      webrtcAdapter.attachDataChannel(remotePeerId, dataChannelWrapper)

      // Handle signaling data from simple-peer
      peer.on("signal", (data: SignalData) => {
        onSignal(remotePeerId, data)
      })

      // Handle incoming remote stream
      peer.on("stream", (stream: MediaStream) => {
        connection.stream = stream
        setRemoteStreams(prev => new Map(prev).set(remotePeerId, stream))
      })

      // Handle connection established
      peer.on("connect", () => {
        connection.connected = true
        setConnectionStates(prev =>
          new Map(prev).set(remotePeerId, "connected"),
        )
        // Notify parent that connection is established
        // This allows clearing accumulated signals to prevent payload bloat
        onConnected?.(remotePeerId)
      })

      // Handle connection closed
      peer.on("close", () => {
        destroyPeer(remotePeerId)
      })

      // Handle errors
      peer.on("error", (err: Error) => {
        console.error(`WebRTC peer error with ${remotePeerId}:`, err)
        setConnectionStates(prev => new Map(prev).set(remotePeerId, "failed"))
      })
    },
    [myPeerId, localStream, onSignal, onConnected, destroyPeer, webrtcAdapter],
  )

  // Pass a signal to a peer
  const signalPeer = useCallback((remotePeerId: PeerID, signal: SignalData) => {
    const connection = peersRef.current.get(remotePeerId)
    if (connection) {
      try {
        // Cast to any because simple-peer's SignalData type is slightly different
        // from our SignalData type (their type field is more restrictive)
        connection.peer.signal(signal as any)
      } catch (err) {
        console.error(`Error processing WebRTC signal:`, err)
      }
    }
  }, [])

  // Check if a peer connection exists
  const hasPeer = useCallback((remotePeerId: PeerID) => {
    return peersRef.current.has(remotePeerId)
  }, [])

  return {
    remoteStreams,
    connectionStates,
    createPeer,
    destroyPeer,
    signalPeer,
    hasPeer,
  }
}
