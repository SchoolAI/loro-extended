import type { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import { generateUUID, type PeerID } from "@loro-extended/repo"
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  isSignalData,
  type SignalData,
  type SignalingPresence,
} from "../shared/types"
import { computePeerActions } from "./domain/peer-actions"
import { usePeerManager } from "./hooks/use-peer-manager"
import { useSignalChannel } from "./hooks/use-signal-channel"

export type { ConnectionState, PeerConnection } from "./hooks/use-peer-manager"

export type UseWebRtcMeshReturn = {
  remoteStreams: Map<PeerID, MediaStream>
  connectionStates: Map<PeerID, "connecting" | "connected" | "failed">
  outgoingSignals: Record<string, SignalData[]>
  instanceId: string
  processIncomingSignals: (fromPeerId: PeerID, signals: SignalData[]) => void
  clearOutgoingSignals: (targetPeerId: PeerID) => void
}

/**
 * Hook to manage WebRTC mesh connections using simple-peer.
 *
 * This hook orchestrates:
 * - usePeerManager: Manages peer connections and streams
 * - useSignalChannel: Handles signal routing and deduplication
 *
 * It also handles:
 * - Participant lifecycle (creating/destroying peers based on participant list)
 * - Presence integration (reading signals from presence, publishing to presence)
 *
 * Note: This hook only handles SignalingPresence (signals), not UserPresence
 * (name, wantsAudio, wantsVideo). User presence is handled separately.
 */
export function useWebRtcMesh(
  myPeerId: PeerID,
  localStream: MediaStream | null,
  participantPeerIds: PeerID[],
  signalingPresence: Record<string, SignalingPresence>,
  setSignalingPresence: (update: Partial<SignalingPresence>) => void,
  webrtcAdapter: WebRtcDataChannelAdapter,
): UseWebRtcMeshReturn {
  // Generate a unique instance ID for this session (refreshes on reload)
  // This allows us to ignore stale signals from previous sessions
  const myInstanceId = useMemo(() => generateUUID(), [])

  // Track the instance ID of remote peers so we can target signals correctly
  const remoteInstanceIdsRef = useRef<Map<PeerID, string>>(new Map())

  // Track which peers were created from incoming signals (non-initiator)
  // These should NOT be destroyed by the participant lifecycle effect
  const signalCreatedPeersRef = useRef<Set<PeerID>>(new Set())

  // Signal channel for routing and deduplication
  const {
    outgoingSignals,
    queueOutgoingSignal,
    clearOutgoingSignals,
    filterNewSignals,
  } = useSignalChannel(myInstanceId)

  // Wrapper to attach targetInstanceId to outgoing signals
  const handleOnSignal = useCallback(
    (targetPeerId: PeerID, signal: SignalData) => {
      const targetInstanceId = remoteInstanceIdsRef.current.get(targetPeerId)
      if (targetInstanceId) {
        signal.targetInstanceId = targetInstanceId
      }
      queueOutgoingSignal(targetPeerId, signal)
    },
    [queueOutgoingSignal],
  )

  // Clear outgoing signals when a connection is established
  // This prevents signal accumulation that can cause PayloadTooLargeError
  const handleOnConnected = useCallback(
    (remotePeerId: PeerID) => {
      clearOutgoingSignals(remotePeerId)
    },
    [clearOutgoingSignals],
  )

  // Peer manager for connection lifecycle
  const {
    remoteStreams,
    connectionStates,
    createPeer,
    destroyPeer,
    signalPeer,
    hasPeer,
  } = usePeerManager({
    myPeerId,
    localStream,
    onSignal: handleOnSignal,
    onConnected: handleOnConnected,
    webrtcAdapter,
  })

  // Process incoming signals from another peer's presence
  const processIncomingSignals = useCallback(
    (fromPeerId: PeerID, signals: SignalData[]) => {
      // Filter to only new signals
      const newSignals = filterNewSignals(fromPeerId, signals)

      for (const signal of newSignals) {
        // Create peer if it doesn't exist (we're the non-initiator)
        if (!hasPeer(fromPeerId)) {
          createPeer(fromPeerId)
          // Mark this peer as created from signals - don't destroy it based on participant list
          signalCreatedPeersRef.current.add(fromPeerId)
        }

        // Pass signal to the peer
        signalPeer(fromPeerId, signal)
      }
    },
    [filterNewSignals, hasPeer, createPeer, signalPeer],
  )

  // Track current peer IDs for cleanup logic
  const currentPeerIdsRef = useRef<Set<PeerID>>(new Set())

  // Manage peer lifecycle based on participant list using pure function
  useEffect(() => {
    const targetPeerIds = new Set(
      participantPeerIds.filter(id => id !== myPeerId),
    )

    // Merge tracked peers with signal-created peers for accurate decision-making
    // Signal-created peers exist in the peer manager but aren't in currentPeerIdsRef
    const allTrackedPeers = new Set([
      ...currentPeerIdsRef.current,
      ...signalCreatedPeersRef.current,
    ])

    // Compute actions using pure function (FC/IS pattern)
    const { toCreate, toDestroy } = computePeerActions(
      allTrackedPeers,
      targetPeerIds,
      signalCreatedPeersRef.current,
      myPeerId,
      !!localStream,
    )

    // Apply create actions
    for (const peerId of toCreate) {
      createPeer(peerId)
      currentPeerIdsRef.current.add(peerId)
    }

    // Apply destroy actions
    for (const peerId of toDestroy) {
      destroyPeer(peerId)
      currentPeerIdsRef.current.delete(peerId)
    }
  }, [participantPeerIds, myPeerId, localStream, createPeer, destroyPeer])

  // Process incoming signals from other peers' signaling presence
  useEffect(() => {
    const myPeerIdStr = String(myPeerId)

    for (const [peerId, presence] of Object.entries(signalingPresence)) {
      if (peerId === myPeerIdStr) {
        continue
      }

      // Store the remote peer's instance ID
      if (presence.instanceId) {
        remoteInstanceIdsRef.current.set(peerId as PeerID, presence.instanceId)
      }

      // Check if this peer has signals addressed to us
      const rawSignals = presence.signals?.[myPeerIdStr]

      if (rawSignals && rawSignals.length > 0) {
        // Validate and filter signals using type guard
        const validSignals = rawSignals.filter(isSignalData)
        const invalidCount = rawSignals.length - validSignals.length
        if (invalidCount > 0) {
          console.warn(
            `[useWebRtcMesh] Filtered ${invalidCount} invalid signal(s) from peer ${peerId}`,
          )
        }
        if (validSignals.length > 0) {
          processIncomingSignals(peerId as PeerID, validSignals)
        }
      }
    }
  }, [signalingPresence, myPeerId, processIncomingSignals])

  // Publish outgoing signals to signaling presence
  useEffect(() => {
    // Always publish our instanceId, even if no signals
    // This allows others to know our current instanceId
    setSignalingPresence({
      instanceId: myInstanceId,
      signals: outgoingSignals,
    })
  }, [outgoingSignals, setSignalingPresence, myInstanceId])

  // Store destroyPeer in a ref so cleanup can access it without dependency issues
  const destroyPeerRef = useRef(destroyPeer)
  destroyPeerRef.current = destroyPeer

  // Cleanup all peers on unmount
  useEffect(() => {
    const currentPeerIds = currentPeerIdsRef.current
    const signalCreatedPeers = signalCreatedPeersRef.current
    const destroy = destroyPeerRef.current

    return () => {
      for (const peerId of currentPeerIds) {
        destroy(peerId)
      }
      for (const peerId of signalCreatedPeers) {
        destroy(peerId)
      }
    }
  }, [])

  return {
    remoteStreams,
    connectionStates,
    outgoingSignals,
    instanceId: myInstanceId,
    processIncomingSignals,
    clearOutgoingSignals,
  }
}
