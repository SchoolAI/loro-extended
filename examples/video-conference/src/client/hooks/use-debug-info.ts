import { useRepo } from "@loro-extended/react"
import type { PeerID } from "@loro-extended/repo"
import { isEstablished } from "@loro-extended/repo"
import { useCallback, useEffect, useState } from "react"
import type { SignalingPresence, UserPresence } from "../../shared/types"
import type { ConnectionState } from "./use-peer-manager"

// Polling interval for non-reactive Loro state (in ms)
const POLL_INTERVAL = 2000

export type PeerConnectionInfo = {
  remotePeerId: PeerID
  connectionState: ConnectionState
  remoteInstanceId?: string
}

export type ChannelInfo = {
  channelId: number
  adapterType: string
  kind: "storage" | "network" | "other"
  peerId?: PeerID
  isEstablished: boolean
}

export type ConnectionSource = "webrtc" | "sse" | "websocket" | "other"

/**
 * Determine the connection source type from an adapter type string.
 */
function getConnectionSource(adapterType: string): ConnectionSource {
  const lower = adapterType.toLowerCase()
  if (lower.includes("webrtc")) {
    return "webrtc"
  }
  if (lower.includes("sse")) {
    return "sse"
  }
  if (lower.includes("websocket") || lower.includes("ws")) {
    return "websocket"
  }
  return "other"
}

export type PresencePeerInfo = {
  peerId: string
  sources: ConnectionSource[]
  hasUserPresence: boolean
  hasSignalingPresence: boolean
}

/**
 * Truncate an ID to show first 4 and last 4 characters with ellipsis.
 * e.g., "abcd1234-5678-efgh" -> "abcd...efgh"
 */
export function truncateId(id: string, prefixLen = 4, suffixLen = 4): string {
  if (id.length <= prefixLen + suffixLen + 3) {
    return id
  }
  return `${id.slice(0, prefixLen)}...${id.slice(-suffixLen)}`
}

export type PeerSeenInfo = {
  peerId: PeerID
  subscriptionCount: number
  channels: ChannelInfo[]
}

export type DebugInfo = {
  // Network Status
  isOnline: boolean

  // Loro Sync Status
  localPeerId: PeerID
  peersSeenCount: number
  peersSeen: PeerSeenInfo[]

  // WebRTC Mesh Status
  instanceId: string
  peerConnections: PeerConnectionInfo[]
  signalQueueSize: number

  // Presence Status
  userPresenceCount: number
  signalingPresenceCount: number
  presencePeers: PresencePeerInfo[]
}

export type UseDebugInfoOptions = {
  userPresence: Record<string, UserPresence>
  signalingPresence: Record<string, SignalingPresence>
  connectionStates: Map<PeerID, ConnectionState>
  instanceId: string
  outgoingSignals: Record<string, unknown[]>
}

export type UseDebugInfoReturn = {
  debugInfo: DebugInfo
  refresh: () => void
}

/**
 * Hook to aggregate debug information from various sources.
 *
 * This hook combines:
 * - navigator.onLine status
 * - Loro synchronizer state (polled, as it's not fully reactive)
 * - WebRTC state from useWebRtcMesh
 * - Presence information
 */
export function useDebugInfo({
  userPresence,
  signalingPresence,
  connectionStates,
  instanceId,
  outgoingSignals,
}: UseDebugInfoOptions): UseDebugInfoReturn {
  const repo = useRepo()
  const localPeerId = repo.identity.peerId

  // Track online status
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  )

  // Loro state (polled)
  const [peersSeen, setPeersSeen] = useState<PeerSeenInfo[]>([])
  const [peersSeenCount, setPeersSeenCount] = useState(0)
  const [allChannels, setAllChannels] = useState<ChannelInfo[]>([])

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Poll Loro synchronizer state
  const pollLoroState = useCallback(() => {
    const synchronizer = repo.synchronizer
    const model = synchronizer.getModelSnapshot()

    // Get all channel info first
    const channelInfos: ChannelInfo[] = []
    const channelsByPeer = new Map<PeerID, ChannelInfo[]>()

    for (const [channelId, channel] of model.channels) {
      const info: ChannelInfo = {
        channelId,
        adapterType: channel.adapterType,
        kind: channel.kind,
        peerId: isEstablished(channel) ? channel.peerId : undefined,
        isEstablished: isEstablished(channel),
      }
      channelInfos.push(info)

      // Group channels by peer
      if (info.peerId) {
        const existing = channelsByPeer.get(info.peerId) || []
        existing.push(info)
        channelsByPeer.set(info.peerId, existing)
      }
    }
    setAllChannels(channelInfos)

    // Get peer info with their associated channels
    const peerInfos: PeerSeenInfo[] = []
    for (const [peerId, peerState] of model.peers) {
      peerInfos.push({
        peerId,
        subscriptionCount: peerState.subscriptions.size,
        channels: channelsByPeer.get(peerId) || [],
      })
    }
    setPeersSeen(peerInfos)
    setPeersSeenCount(model.peers.size)
  }, [repo])

  // Set up polling interval
  useEffect(() => {
    // Initial poll
    pollLoroState()

    const interval = setInterval(pollLoroState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [pollLoroState])

  // Calculate signal queue size
  const signalQueueSize = Object.values(outgoingSignals).reduce(
    (total, signals) => total + (signals?.length ?? 0),
    0,
  )

  // Build peer connection info from connectionStates and signalingPresence
  const peerConnections: PeerConnectionInfo[] = []
  for (const [peerId, state] of connectionStates) {
    const remotePresence = signalingPresence[peerId]
    peerConnections.push({
      remotePeerId: peerId,
      connectionState: state,
      remoteInstanceId: remotePresence?.instanceId,
    })
  }

  // Build a map of adapter types we're connected through
  // This helps us understand which adapters are active
  const activeAdapterTypes = new Set<ConnectionSource>()
  for (const channel of allChannels) {
    if (channel.isEstablished) {
      activeAdapterTypes.add(getConnectionSource(channel.adapterType))
    }
  }

  // Build presence peer info
  const presencePeers: PresencePeerInfo[] = []
  const allPeerIds = new Set([
    ...Object.keys(userPresence),
    ...Object.keys(signalingPresence),
  ])

  for (const peerId of allPeerIds) {
    if (peerId === localPeerId) continue

    // Determine sources by checking which adapters the peer is connected through
    const sources = new Set<ConnectionSource>()

    // Check channels to determine connection types for this specific peer
    for (const channel of allChannels) {
      if (channel.peerId === peerId && channel.isEstablished) {
        sources.add(getConnectionSource(channel.adapterType))
      }
    }

    // If no direct channel to this peer, but we have presence data,
    // it's likely coming through a hub (SSE/WebSocket server)
    // Check if we have any hub-type adapters active
    if (sources.size === 0) {
      if (activeAdapterTypes.has("sse")) {
        sources.add("sse")
      }
      if (activeAdapterTypes.has("websocket")) {
        sources.add("websocket")
      }
    }

    presencePeers.push({
      peerId,
      sources: Array.from(sources),
      hasUserPresence: peerId in userPresence,
      hasSignalingPresence: peerId in signalingPresence,
    })
  }

  const debugInfo: DebugInfo = {
    // Network Status
    isOnline,

    // Loro Sync Status
    localPeerId,
    peersSeenCount,
    peersSeen,

    // WebRTC Mesh Status
    instanceId,
    peerConnections,
    signalQueueSize,

    // Presence Status
    userPresenceCount: presencePeers.length,
    signalingPresenceCount: Object.keys(signalingPresence).length,
    presencePeers,
  }

  return {
    debugInfo,
    refresh: pollLoroState,
  }
}
