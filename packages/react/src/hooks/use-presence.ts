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
 * A hook that provides a reactive interface to the presence without schema validation.
 *
 * @param docId The document ID to connect to.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function useUntypedPresence<T extends ObjectValue = ObjectValue>(
  docId: DocId,
): PresenceContext<T>
export function useUntypedPresence<
  T extends ObjectValue = ObjectValue,
  R = any,
>(docId: DocId, selector: (state: PresenceContext<T>) => R): R
export function useUntypedPresence<
  T extends ObjectValue = ObjectValue,
  R = any,
>(docId: DocId, selector?: (state: PresenceContext<T>) => R) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the presence
  const store = useMemo(() => {
    if (!handle) {
      const empty = {
        self: {} as T,
        all: {},
        setSelf: (_: any) => {},
      }
      return {
        subscribe: () => () => {},
        getSnapshot: () => empty,
      }
    }

    const setSelf = (values: Partial<T>) => {
      handle.untypedPresence.set(values)
    }

    const computeState = () => {
      const all = handle.untypedPresence.all as Record<string, T>
      const self = handle.untypedPresence.self as T

      return { self, all, setSelf }
    }

    let cachedState = computeState()

    const subscribe = (callback: () => void) => {
      return handle.untypedPresence.subscribe(() => {
        cachedState = computeState()
        callback()
      })
    }

    const getSnapshot = () => cachedState

    return { subscribe, getSnapshot }
  }, [handle])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  if (selector) {
    return selector(state as PresenceContext<T>)
  }

  return state
}

/**
 * A hook that provides a reactive interface to the presence with schema validation.
 *
 * @param docId The document ID to connect to.
 * @param shape The schema shape for the presence.
 * @param emptyState The initial empty state for the presence.
 * @param selector Optional selector function to subscribe to specific parts of the state.
 */
export function usePresence<S extends ContainerShape | ValueShape>(
  docId: DocId,
  shape: S,
  emptyState: InferPlainType<S>,
): PresenceContext<InferPlainType<S>>
export function usePresence<S extends ContainerShape | ValueShape, R = any>(
  docId: DocId,
  shape: S,
  emptyState: InferPlainType<S>,
  selector: (state: PresenceContext<InferPlainType<S>>) => R,
): R
export function usePresence<S extends ContainerShape | ValueShape, R = any>(
  docId: DocId,
  shape: S,
  emptyState: InferPlainType<S>,
  selector?: (state: PresenceContext<InferPlainType<S>>) => R,
) {
  const { handle } = useDocHandleState(docId)

  // Create a stable store that wraps the presence
  const store = useMemo(() => {
    if (!handle) {
      const empty = {
        self: emptyState,
        all: {},
        setSelf: (_: any) => {},
      }
      return {
        subscribe: () => () => {},
        getSnapshot: () => empty,
      }
    }

    const typedPresence = handle.presence(shape, emptyState)
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
  }, [handle, shape, emptyState])

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  if (selector) {
    return selector(state as PresenceContext<InferPlainType<S>>)
  }

  return state
}
