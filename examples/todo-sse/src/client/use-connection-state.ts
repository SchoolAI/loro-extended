import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
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
    // Find the SSE adapter in the repo's network adapters
    const sseAdapter = repo.synchronizer.adapters.adapters.find(
      (adapter: any) => adapter instanceof SseClientNetworkAdapter,
    ) as SseClientNetworkAdapter | undefined

    if (!sseAdapter) {
      console.warn("SseClientNetworkAdapter not found in repo")
      return
    }

    // Subscribe to state changes
    const unsubscribe = sseAdapter.subscribe(newState => {
      setState(newState)
    })

    return () => {
      unsubscribe()
    }
  }, [repo])

  return state
}