import type { DocId } from "@loro-extended/repo"
import type { Value } from "loro-crdt"
import { useMemo, useSyncExternalStore } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

export type RoomContext<T> = {
  self: T
  all: Record<string, T>
  setSelf: (value: Partial<T>) => void
}

type ObjectValue = {
  [key: string]: Value
}

/**
 * A hook that provides a reactive interface to the room (presence).
 *
 * @param docId The document ID to connect to.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function useRoom<T extends ObjectValue = ObjectValue>(
  docId: DocId,
): RoomContext<T>
export function useRoom<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector: (state: RoomContext<T>) => R,
): R
export function useRoom<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector?: (state: RoomContext<T>) => R,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the room
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
      handle.room.set(values)
    }

    const computeState = () => {
      const all = handle.room.all as Record<string, T>
      const self = handle.room.self as T

      return { self, all, setSelf }
    }

    let cachedState = computeState()

    const subscribe = (callback: () => void) => {
      return handle.room.subscribe(() => {
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
