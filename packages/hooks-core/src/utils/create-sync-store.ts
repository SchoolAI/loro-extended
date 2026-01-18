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
 * Error Handling:
 * - Errors in `computeValue` during subscription are caught and logged
 * - The previous cached value is preserved when errors occur
 * - Errors during initial computation are re-thrown (fail fast on mount)
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
  // Initialize cache - errors here should propagate (fail fast on mount)
  cacheRef.current = computeValue()

  const subscribe = (onStoreChange: () => void) => {
    return subscribeToSource(() => {
      try {
        cacheRef.current = computeValue()
        onStoreChange()
      } catch (error) {
        // Log the error but don't propagate it to React
        // This prevents subscription errors from breaking the entire component tree
        console.error("[createSyncStore] Error computing value:", error)
        // Keep the previous cached value - don't call onStoreChange
        // since the value hasn't actually changed
      }
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
