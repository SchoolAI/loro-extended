import type { PeerID } from "@loro-extended/repo"
import { useCallback, useRef, useState } from "react"
// Use the minified browser build to avoid Node.js polyfill issues
import Peer from "simple-peer/simplepeer.min.js"
import type { SignalData } from "../../shared/types"
import { shouldInitiate, ICE_SERVERS } from "../../shared/webrtc-protocol"

export type ConnectionState = "connecting" | "connected" | "failed"

export type PeerConnection = {
  peer: Peer.Instance
  stream: MediaStream | null
  connected: boolean
}

export type UsePeerManagerOptions = {
  myPeerId: PeerID
  localStream: MediaStream | null
  onSignal: (targetPeerId: PeerID, signal: SignalData) => void
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
}: UsePeerManagerOptions): UsePeerManagerReturn {
  // Map of peerId -> PeerConnection
  const peersRef = useRef<Map<PeerID, PeerConnection>>(new Map())

  // Remote streams for rendering
  const [remoteStreams, setRemoteStreams] = useState<Map<PeerID, MediaStream>>(
    new Map()
  )

  // Connection states for UI
  const [connectionStates, setConnectionStates] = useState<
    Map<PeerID, ConnectionState>
  >(new Map())

  // Cleanup a peer connection
  const destroyPeer = useCallback((remotePeerId: PeerID) => {
    const connection = peersRef.current.get(remotePeerId)
    if (connection) {
      connection.peer.destroy()
      peersRef.current.delete(remotePeerId)
      setRemoteStreams((prev) => {
        const next = new Map(prev)
        next.delete(remotePeerId)
        return next
      })
      setConnectionStates((prev) => {
        const next = new Map(prev)
        next.delete(remotePeerId)
        return next
      })
    }
  }, [])

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
      setConnectionStates((prev) => new Map(prev).set(remotePeerId, "connecting"))

      // Handle signaling data from simple-peer
      peer.on("signal", (data: SignalData) => {
        onSignal(remotePeerId, data)
      })

      // Handle incoming remote stream
      peer.on("stream", (stream: MediaStream) => {
        connection.stream = stream
        setRemoteStreams((prev) => new Map(prev).set(remotePeerId, stream))
      })

      // Handle connection established
      peer.on("connect", () => {
        connection.connected = true
        setConnectionStates((prev) => new Map(prev).set(remotePeerId, "connected"))
      })

      // Handle connection closed
      peer.on("close", () => {
        destroyPeer(remotePeerId)
      })

      // Handle errors
      peer.on("error", (err: Error) => {
        console.error(`WebRTC peer error with ${remotePeerId}:`, err)
        setConnectionStates((prev) => new Map(prev).set(remotePeerId, "failed"))
      })
    },
    [myPeerId, localStream, onSignal, destroyPeer]
  )

  // Pass a signal to a peer
  const signalPeer = useCallback(
    (remotePeerId: PeerID, signal: SignalData) => {
      const connection = peersRef.current.get(remotePeerId)
      if (connection) {
        try {
          connection.peer.signal(signal)
        } catch (err) {
          console.error(`Error processing WebRTC signal:`, err)
        }
      }
    },
    []
  )

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