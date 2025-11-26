import type { DocId } from "@loro-extended/repo"
import type { Value } from "loro-crdt"
import { useMemo, useSyncExternalStore } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

export type PresenceContext<T> = {
  self: T
  all: Record<string, T>
  setSelf: (value: Partial<T>) => void
}

type ObjectValue = {
  [key: string]: Value
}

/**
 * A hook that provides a reactive interface to the presence.
 *
 * @param docId The document ID to connect to.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function usePresence<T extends ObjectValue = ObjectValue>(
  docId: DocId,
): PresenceContext<T>
export function usePresence<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector: (state: PresenceContext<T>) => R,
): R
export function usePresence<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector?: (state: PresenceContext<T>) => R,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the presence
  const store = useMemo(() => {
    if (!handle) {
      const emptyState = {
        self: {} as T,
        all: {},
        setSelf: () => {},
      }
      return {
        subscribe: () => () => {},
        getSnapshot: () => emptyState,
      }
    }

    const setSelf = (values: Partial<T>) => {
      handle.presence.set(values)
    }

    const computeState = () => {
      const all = handle.presence.all as Record<string, T>
      const self = handle.presence.self as T

      return { self, all, setSelf }
    }

    let cachedState = computeState()

    const subscribe = (callback: () => void) => {
      return handle.presence.subscribe(() => {
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
