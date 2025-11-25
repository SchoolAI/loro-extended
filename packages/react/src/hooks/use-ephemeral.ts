import type { DocId } from "@loro-extended/repo"
import type { Value } from "loro-crdt"
import { useMemo, useSyncExternalStore } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

export type EphemeralContext<T> = {
  self: T
  all: Record<string, T>
  setSelf: (value: Partial<T>) => void
}

type ObjectValue = {
  [key: string]: Value
}

/**
 * A hook that provides a reactive interface to the ephemeral store (presence).
 *
 * @param docId The document ID to connect to.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function useEphemeral<T extends ObjectValue = ObjectValue>(
  docId: DocId,
): EphemeralContext<T>
export function useEphemeral<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector: (state: EphemeralContext<T>) => R,
): R
export function useEphemeral<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector?: (state: EphemeralContext<T>) => R,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the ephemeral store
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
      handle.ephemeral.set(values)
    }

    const computeState = () => {
      const all = handle.ephemeral.all as Record<string, T>
      const self = handle.ephemeral.self as T

      return { self, all, setSelf }
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
  }, [handle, docId])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  if (selector) {
    return selector(state)
  }

  return state
}
