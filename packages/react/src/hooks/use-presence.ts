import type {
  ContainerShape,
  InferPlainType,
  ValueShape,
} from "@loro-extended/change"
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
export function usePresence<S extends ContainerShape | ValueShape>(
  docId: DocId,
  shape: S,
  emptyState: InferPlainType<S>,
): PresenceContext<InferPlainType<S>>
export function usePresence<T extends ObjectValue = ObjectValue, R = any>(
  docId: DocId,
  selector: (state: PresenceContext<T>) => R,
): R
export function usePresence<
  T extends ObjectValue = ObjectValue,
  S extends ContainerShape | ValueShape = any,
  R = any,
>(
  docId: DocId,
  shapeOrSelector?: S | ((state: PresenceContext<T>) => R),
  emptyState?: InferPlainType<S>,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the presence
  const store = useMemo(() => {
    const isTyped =
      shapeOrSelector &&
      typeof shapeOrSelector === "object" &&
      "_type" in shapeOrSelector &&
      emptyState !== undefined

    if (!handle) {
      const empty = isTyped
        ? {
            self: emptyState,
            all: {},
            setSelf: (_: any) => {},
          }
        : {
            self: {} as T,
            all: {},
            setSelf: (_: any) => {},
          }
      return {
        subscribe: () => () => {},
        getSnapshot: () => empty,
      }
    }

    if (isTyped) {
      const typedPresence = handle.typedPresence(
        shapeOrSelector as S,
        emptyState as InferPlainType<S>,
      )
      const setSelf = (values: Partial<InferPlainType<S>>) => {
        typedPresence.set(values)
      }

      const computeState = () => {
        return {
          self: typedPresence.self,
          all: typedPresence.all,
          setSelf,
        }
      }

      let cachedState = computeState()

      const subscribe = (callback: () => void) => {
        return typedPresence.subscribe(() => {
          cachedState = computeState()
          callback()
        })
      }

      const getSnapshot = () => cachedState
      return { subscribe, getSnapshot }
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
  }, [handle, shapeOrSelector, emptyState])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  if (shapeOrSelector && typeof shapeOrSelector === "function") {
    return shapeOrSelector(state as PresenceContext<T>)
  }

  return state
}
