/**
 * Interface for a sync store compatible with useSyncExternalStore.
 */
export interface SyncStore<T> {
  subscribe: (onStoreChange: () => void) => () => void
  getSnapshot: () => T
}

/**
 * Creates a sync store that caches computed values and notifies subscribers on changes.
 * This utility extracts the common pattern used by useDoc, useEphemeral, and useUndoManager.
 *
 * @param computeValue - Function to compute the current value
 * @param subscribeToSource - Function to subscribe to the underlying data source
 * @param cacheRef - A ref object to store the cached value
 * @returns A SyncStore compatible with useSyncExternalStore
 *
 * @example
 * ```ts
 * const cacheRef = useRef<MyValue | null>(null)
 * const store = useMemo(() => createSyncStore(
 *   () => computeMyValue(),
 *   (onChange) => source.subscribe(onChange),
 *   cacheRef,
 * ), [source])
 * return useSyncExternalStore(store.subscribe, store.getSnapshot)
 * ```
 */
export function createSyncStore<T>(
  computeValue: () => T,
  subscribeToSource: (onChange: () => void) => () => void,
  cacheRef: { current: T | null },
): SyncStore<T> {
  // Initialize cache
  cacheRef.current = computeValue()

  const subscribe = (onStoreChange: () => void) => {
    return subscribeToSource(() => {
      cacheRef.current = computeValue()
      onStoreChange()
    })
  }

  const getSnapshot = (): T => {
    if (cacheRef.current === null) {
      cacheRef.current = computeValue()
    }
    return cacheRef.current
  }

  return { subscribe, getSnapshot }
}
