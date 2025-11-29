import type { PeerID } from "@loro-extended/repo"
import { useCallback, useEffect, useRef, useState } from "react"
// Use the minified browser build to avoid Node.js polyfill issues
import Peer from "simple-peer/simplepeer.min.js"
import type { SignalData, SignalingPresence, SignalsMap } from "../shared/types"

// ICE servers for WebRTC connection
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
]

export type PeerConnection = {
  peer: Peer.Instance
  stream: MediaStream | null
  connected: boolean
}

export type UseWebRtcMeshReturn = {
  remoteStreams: Map<PeerID, MediaStream>
  connectionStates: Map<PeerID, "connecting" | "connected" | "failed">
  outgoingSignals: SignalsMap
  processIncomingSignals: (
    fromPeerId: PeerID,
    signals: SignalData[],
  ) => void
  clearOutgoingSignals: (targetPeerId: PeerID) => void
}

/**
 * Hook to manage WebRTC mesh connections using simple-peer
 */
export function useWebRtcMesh(
  myPeerId: PeerID,
  localStream: MediaStream | null,
  participantPeerIds: PeerID[],
  allPresence: Record<string, SignalingPresence>,
  setSelfPresence: (update: Partial<SignalingPresence>) => void,
): UseWebRtcMeshReturn {
  // Map of peerId -> PeerConnection
  const peersRef = useRef<Map<PeerID, PeerConnection>>(new Map())
  
  // Track which peers were created from incoming signals (non-initiator)
  // These should NOT be destroyed by the participant lifecycle effect
  const signalCreatedPeersRef = useRef<Set<PeerID>>(new Set())

  // Remote streams for rendering
  const [remoteStreams, setRemoteStreams] = useState<Map<PeerID, MediaStream>>(
    new Map(),
  )

  // Connection states for UI
  const [connectionStates, setConnectionStates] = useState<
    Map<PeerID, "connecting" | "connected" | "failed">
  >(new Map())

  // Outgoing signals to publish via presence
  const [outgoingSignals, setOutgoingSignals] = useState<SignalsMap>({})

  // Track which signals we've already processed to avoid duplicates
  const processedSignalsRef = useRef<Set<string>>(new Set())

  // Cleanup a peer connection
  const cleanupPeer = useCallback((remotePeerId: PeerID) => {
    const connection = peersRef.current.get(remotePeerId)
    if (connection) {
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
  }, [])

  // Create a peer connection for a remote participant
  const createPeer = useCallback(
    (remotePeerId: PeerID) => {
      if (peersRef.current.has(remotePeerId)) {
        return
      }

      // Deterministic initiator: numerically smaller peerId initiates
      // Use BigInt comparison since peerIds are large numeric strings
      const isInitiator = BigInt(myPeerId) < BigInt(remotePeerId)

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

      // Handle signaling data from simple-peer
      peer.on("signal", (data: SignalData) => {
        // Append to outgoing signals for this target peer
        setOutgoingSignals(prev => ({
          ...prev,
          [remotePeerId]: [...(prev[remotePeerId] || []), data],
        }))
      })

      // Handle incoming remote stream
      peer.on("stream", (stream: MediaStream) => {
        connection.stream = stream
        setRemoteStreams(prev => new Map(prev).set(remotePeerId, stream))
      })

      // Handle connection established
      peer.on("connect", () => {
        connection.connected = true
        setConnectionStates(prev => new Map(prev).set(remotePeerId, "connected"))
      })

      // Handle connection closed
      peer.on("close", () => {
        cleanupPeer(remotePeerId)
      })

      // Handle errors
      peer.on("error", (err: Error) => {
        console.error(`WebRTC peer error with ${remotePeerId}:`, err)
        setConnectionStates(prev => new Map(prev).set(remotePeerId, "failed"))
      })
    },
    [myPeerId, localStream, cleanupPeer],
  )

  // Process incoming signals from another peer's presence
  const processIncomingSignals = useCallback(
    (fromPeerId: PeerID, signals: SignalData[]) => {
      for (const signal of signals) {
        // Create a unique ID for this signal to avoid reprocessing
        const signalId = `${fromPeerId}:${JSON.stringify(signal)}`

        if (processedSignalsRef.current.has(signalId)) {
          continue
        }

        processedSignalsRef.current.add(signalId)

        // Get or create the peer connection
        let connection = peersRef.current.get(fromPeerId)
        
        if (!connection) {
          // Create peer if it doesn't exist (we're the non-initiator)
          createPeer(fromPeerId)
          connection = peersRef.current.get(fromPeerId)
          // Mark this peer as created from signals - don't destroy it based on participant list
          signalCreatedPeersRef.current.add(fromPeerId)
        }

        if (connection) {
          try {
            connection.peer.signal(signal)
          } catch (err) {
            console.error(`Error processing WebRTC signal:`, err)
          }
        }
      }
    },
    [createPeer],
  )

  // Clear outgoing signals for a peer (after connection established)
  const clearOutgoingSignals = useCallback((targetPeerId: PeerID) => {
    setOutgoingSignals(prev => {
      const next = { ...prev }
      delete next[targetPeerId]
      return next
    })
  }, [])

  // Manage peer lifecycle based on participant list
  // Only create peers for participants where WE are the initiator
  // Don't destroy peers that were created from incoming signals
  // IMPORTANT: Only create initiator peers when we have our local stream ready
  useEffect(() => {
    const currentPeerIds = new Set(peersRef.current.keys())
    const targetPeerIds = new Set(
      participantPeerIds.filter(id => id !== myPeerId),
    )

    // Create peers for new participants (only if we're the initiator AND we have our stream)
    for (const peerId of targetPeerIds) {
      if (!currentPeerIds.has(peerId)) {
        // Only create if we're the initiator (numerically smaller peerId)
        const weAreInitiator = BigInt(myPeerId) < BigInt(peerId)
        if (weAreInitiator && localStream) {
          // Wait until we have our local stream before creating initiator peers
          // This ensures our offer includes media tracks
          createPeer(peerId)
        }
      }
    }

    // Destroy peers for removed participants
    // BUT don't destroy signal-created peers - they manage their own lifecycle
    for (const peerId of currentPeerIds) {
      if (!targetPeerIds.has(peerId)) {
        if (!signalCreatedPeersRef.current.has(peerId)) {
          cleanupPeer(peerId)
        }
      }
    }
  }, [participantPeerIds, myPeerId, localStream, createPeer, cleanupPeer])

  // Process incoming signals from other peers' presence
  useEffect(() => {
    const myPeerIdStr = String(myPeerId)
    
    for (const [peerId, presence] of Object.entries(allPresence)) {
      if (peerId === myPeerIdStr) {
        continue
      }

      // Check if this peer has signals addressed to us
      const signalsForMe = presence.signals?.[myPeerIdStr]
      
      if (signalsForMe && signalsForMe.length > 0) {
        processIncomingSignals(peerId as PeerID, signalsForMe)
      }
    }
  }, [allPresence, myPeerId, processIncomingSignals])

  // Publish outgoing signals to presence
  useEffect(() => {
    if (Object.keys(outgoingSignals).length > 0) {
      setSelfPresence({ signals: outgoingSignals })
    }
  }, [outgoingSignals, setSelfPresence])

  // Cleanup all peers on unmount
  useEffect(() => {
    return () => {
      for (const peerId of peersRef.current.keys()) {
        cleanupPeer(peerId)
      }
    }
  }, [cleanupPeer])

  return {
    remoteStreams,
    connectionStates,
    outgoingSignals,
    processIncomingSignals,
    clearOutgoingSignals,
  }
}