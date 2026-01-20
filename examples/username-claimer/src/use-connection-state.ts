import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { useRepo } from "@loro-extended/react"
import { useCallback, useEffect, useState } from "react"

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export interface ConnectionStateResult {
  state: ConnectionState
  isSimulatedOffline: boolean
  effectiveState: ConnectionState
  toggleSimulatedOffline: () => void
}

export function useConnectionState(): ConnectionState {
  const { effectiveState } = useConnectionStateWithToggle()
  return effectiveState
}

export function useConnectionStateWithToggle(): ConnectionStateResult {
  const repo = useRepo()
  const [realState, setRealState] = useState<ConnectionState>("disconnected")
  const [isSimulatedOffline, setIsSimulatedOffline] = useState(false)

  useEffect(() => {
    // Find the WebSocket adapter in the repo's network adapters
    const wsAdapter = repo.synchronizer.adapters.adapters.find(
      (adapter): adapter is WsClientNetworkAdapter =>
        adapter instanceof WsClientNetworkAdapter,
    )

    if (!wsAdapter) {
      console.warn("WsClientNetworkAdapter not found in repo")
      return
    }

    // Subscribe to state changes
    const unsubscribe = wsAdapter.subscribe(newState => {
      setRealState(newState)
    })

    return () => {
      unsubscribe()
    }
  }, [repo])

  const toggleSimulatedOffline = useCallback(() => {
    setIsSimulatedOffline(prev => !prev)
  }, [])

  // When simulated offline, report as disconnected regardless of real state
  const effectiveState: ConnectionState = isSimulatedOffline
    ? "disconnected"
    : realState

  return {
    state: realState,
    isSimulatedOffline,
    effectiveState,
    toggleSimulatedOffline,
  }
}
