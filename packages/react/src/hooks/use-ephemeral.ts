import type { DocId } from "@loro-extended/repo"
import { useMemo, useSyncExternalStore } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

export type EphemeralContext<T> = {
  self: T
  peers: Record<string, T>
  others: Record<string, T>
  setSelf: (value: Partial<T>) => void
}

/**
 * A hook that provides a reactive interface to the ephemeral store (presence).
 *
 * @param docId The document ID to connect to.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function useEphemeral<T = any>(docId: DocId): EphemeralContext<T>
export function useEphemeral<T = any, R = any>(
  docId: DocId,
  selector: (state: EphemeralContext<T>) => R,
): R
export function useEphemeral<T = any, R = any>(
  docId: DocId,
  selector?: (state: EphemeralContext<T>) => R,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the ephemeral store
  const store = useMemo(() => {
    if (!handle) {
      const emptyState = {
        self: {} as T,
        peers: {},
        others: {},
        setSelf: () => {},
      }
      return {
        subscribe: () => () => {},
        getSnapshot: () => emptyState,
      }
    }

    const setSelf = (value: Partial<T>) => {
      Object.entries(value).forEach(([key, val]) => {
        handle.ephemeral.set(key, val)
      })
    }

    const computeState = () => {
      const peers = handle.ephemeral.all
      const self = peers[handle.peerId] || ({} as T)
      const others = { ...peers }
      delete others[handle.peerId]

      return { self, peers, others, setSelf }
    }

    let cachedState = computeState()

    const subscribe = (callback: () => void) => {
      return handle.ephemeral.subscribe(() => {
        cachedState = computeState()
        callback()
      })
    }

    const getSnapshot = () => cachedState

    return { subscribe, getSnapshot }
  }, [handle])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  if (selector) {
    return selector(state)
  }

  return state
}