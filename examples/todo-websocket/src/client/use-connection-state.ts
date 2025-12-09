import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { useRepo } from "@loro-extended/react"
import { useEffect, useState } from "react"

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export function useConnectionState(): ConnectionState {
  const repo = useRepo()
  const [state, setState] = useState<ConnectionState>("disconnected")

  useEffect(() => {
    // Find the WebSocket adapter in the repo's network adapters
    const wsAdapter = repo.synchronizer.adapters.adapters.find(
      (adapter: any) => adapter instanceof WsClientNetworkAdapter,
    ) as WsClientNetworkAdapter | undefined

    if (!wsAdapter) {
      console.warn("WsClientNetworkAdapter not found in repo")
      return
    }

    // Subscribe to state changes
    const unsubscribe = wsAdapter.subscribe(newState => {
      setState(newState)
    })

    return () => {
      unsubscribe()
    }
  }, [repo])

  return state
}
