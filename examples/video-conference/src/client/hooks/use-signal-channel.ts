import type { PeerID } from "@loro-extended/repo"
import { useCallback, useRef, useState } from "react"
import type { SignalData, SignalsMap } from "../../shared/types"
import { createSignalId } from "../../shared/webrtc-protocol"

export type UseSignalChannelReturn = {
  /** Outgoing signals to publish via presence, keyed by target peer ID */
  outgoingSignals: SignalsMap
  /** Queue an outgoing signal for a target peer */
  queueOutgoingSignal: (targetPeerId: PeerID, signal: SignalData) => void
  /** Clear outgoing signals for a peer (e.g., after connection established) */
  clearOutgoingSignals: (targetPeerId: PeerID) => void
  /** Process incoming signals, returns only new (not yet processed) signals */
  filterNewSignals: (fromPeerId: PeerID, signals: SignalData[]) => SignalData[]
}

/**
 * Hook to manage WebRTC signal routing and deduplication.
 *
 * This hook handles:
 * - Accumulating outgoing signals for each target peer
 * - Deduplicating incoming signals to avoid reprocessing
 * - Clearing signals after connection is established
 *
 * It does NOT handle:
 * - Actual peer connections (use usePeerManager)
 * - Presence integration (handled by parent hook)
 */
export function useSignalChannel(myInstanceId: string): UseSignalChannelReturn {
  // Outgoing signals to publish via presence
  const [outgoingSignals, setOutgoingSignals] = useState<SignalsMap>({})

  // Track which signals we've already processed to avoid duplicates
  // Uses signal ID (peerId + JSON.stringify) for deduplication
  const processedSignalsRef = useRef<Set<string>>(new Set())

  // Queue an outgoing signal for a target peer
  const queueOutgoingSignal = useCallback(
    (targetPeerId: PeerID, signal: SignalData) => {
      setOutgoingSignals(prev => ({
        ...prev,
        [targetPeerId]: [...(prev[targetPeerId] || []), signal],
      }))
    },
    [],
  )

  // Clear outgoing signals for a peer (after connection established)
  const clearOutgoingSignals = useCallback((targetPeerId: PeerID) => {
    setOutgoingSignals(prev => {
      const next = { ...prev }
      delete next[targetPeerId]
      return next
    })
  }, [])

  // Filter incoming signals to only return new ones
  const filterNewSignals = useCallback(
    (fromPeerId: PeerID, signals: SignalData[]): SignalData[] => {
      const newSignals: SignalData[] = []

      for (const signal of signals) {
        // 1. Check if signal is intended for this instance
        // If targetInstanceId is present but doesn't match, ignore it
        if (
          signal.targetInstanceId &&
          signal.targetInstanceId !== myInstanceId
        ) {
          continue
        }

        // Create a unique ID for this signal to avoid reprocessing
        const signalId = createSignalId(fromPeerId, signal)

        if (!processedSignalsRef.current.has(signalId)) {
          processedSignalsRef.current.add(signalId)
          newSignals.push(signal)
        }
      }

      return newSignals
    },
    [myInstanceId],
  )

  return {
    outgoingSignals,
    queueOutgoingSignal,
    clearOutgoingSignals,
    filterNewSignals,
  }
}
