import type { DocShape, Infer } from "@loro-extended/change"
import type {
  DocId,
  EphemeralDeclarations,
  Handle,
  HandleWithEphemerals,
  Repo,
  TypedEphemeral,
} from "@loro-extended/repo"

export interface FrameworkHooks {
  useState: <T>(
    initialState: T | (() => T),
  ) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  // biome-ignore lint/complexity/noBannedTypes: same as original
  useCallback: <T extends Function>(callback: T, deps: unknown[]) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T | null }
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ) => Snapshot
  useContext: <T>(context: any) => T
  createContext: <T>(defaultValue: T) => any
}

export function createHooks(framework: FrameworkHooks) {
  const {
    useState,
    useMemo,
    useRef,
    useSyncExternalStore,
    useContext,
    createContext,
  } = framework

  // ============================================
  // RepoContext & useRepo
  // ============================================

  const RepoContext = createContext<Repo | null>(null)

  function useRepo(): Repo {
    const repo = useContext(RepoContext)
    if (!repo) throw new Error("useRepo must be used within a RepoProvider")
    return repo as Repo
  }

  // ============================================
  // useHandle - Get typed handle (stable, never re-renders)
  // ============================================

  // Overload: without ephemeral stores
  function useHandle<D extends DocShape>(
    docId: DocId,
    docSchema: D,
  ): Handle<D, Record<string, never>>

  // Overload: with ephemeral stores (including presence)
  function useHandle<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes: E,
  ): HandleWithEphemerals<D, E>

  // Implementation
  function useHandle<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes?: E,
  ): HandleWithEphemerals<D, E> | Handle<D, Record<string, never>> {
    const repo = useRepo()

    // Synchronous initialization - no null state, no flickering
    const [handle] = useState(() => {
      if (ephemeralShapes) {
        return repo.get(docId, docSchema, ephemeralShapes)
      }
      return repo.get(docId, docSchema)
    })

    return handle as
      | HandleWithEphemerals<D, E>
      | Handle<D, Record<string, never>>
  }

  // ============================================
  // useDoc - Get document JSON snapshot (reactive)
  // ============================================

  // Overload: with selector (fine-grained)
  function useDoc<D extends DocShape, R>(
    handle: Handle<D, EphemeralDeclarations>,
    selector: (doc: Infer<D>) => R,
  ): R

  // Overload: without selector (full doc JSON)
  function useDoc<D extends DocShape>(
    handle: Handle<D, EphemeralDeclarations>,
  ): Infer<D>

  // Implementation
  function useDoc<D extends DocShape, R>(
    handle: Handle<D, EphemeralDeclarations>,
    selector?: (doc: Infer<D>) => R,
  ): R | Infer<D> {
    // Use a ref to cache the snapshot and track version
    const cacheRef = useRef<{
      version: number
      value: R | Infer<D>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      const computeValue = (): R | Infer<D> => {
        const json = handle.doc.toJSON()
        return selector ? selector(json) : json
      }

      // Initialize cache
      const version = handle.loroDoc.opCount()
      cacheRef.current = {
        version,
        value: computeValue(),
      }

      const subscribe = (onStoreChange: () => void) => {
        return handle.loroDoc.subscribe(() => {
          // Update cache on change
          const newVersion = handle.loroDoc.opCount()
          if (!cacheRef.current || cacheRef.current.version !== newVersion) {
            cacheRef.current = {
              version: newVersion,
              value: computeValue(),
            }
          }
          onStoreChange()
        })
      }

      const getSnapshot = (): R | Infer<D> => {
        const currentVersion = handle.loroDoc.opCount()
        if (!cacheRef.current || cacheRef.current.version !== currentVersion) {
          cacheRef.current = {
            version: currentVersion,
            value: computeValue(),
          }
        }
        if (!cacheRef.current) {
          throw new Error("useDoc: cache not initialized")
        }
        return cacheRef.current.value
      }

      return { subscribe, getSnapshot }
    }, [handle, selector])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  // ============================================
  // usePresence - Get presence state (reactive)
  // ============================================

  /**
   * Hook to get reactive presence state from a handle with a 'presence' ephemeral store.
   *
   * @deprecated Use `useEphemeral(handle.presence)` instead. The `usePresence` hook assumes
   * a hard-coded 'presence' store, but the unified ephemeral store model treats all stores
   * equally. Using `useEphemeral` directly is more flexible and explicit.
   *
   * @param handle - A handle with a 'presence' ephemeral store
   * @returns An object with `self` (your presence) and `peers` (others' presence)
   *
   * @example
   * ```tsx
   * // Deprecated:
   * const { self, peers } = usePresence(handle)
   *
   * // Preferred:
   * const { self, peers } = useEphemeral(handle.presence)
   * ```
   */
  function usePresence<P>(handle: { presence: TypedEphemeral<P> }): {
    self: P | undefined
    peers: Map<string, P>
  } {
    // Deprecation warning - only show once per session
    if (
      typeof globalThis !== "undefined" &&
      !(globalThis as Record<string, unknown>).__usePresenceDeprecationWarned
    ) {
      ;(globalThis as Record<string, unknown>).__usePresenceDeprecationWarned =
        true
      console.warn(
        "[loro-extended] usePresence is deprecated. Use useEphemeral(handle.presence) instead.",
      )
    }
    return useEphemeral(handle.presence)
  }

  // ============================================
  // useEphemeral - Get any ephemeral store state (reactive)
  // ============================================

  /**
   * Hook to get reactive state from any ephemeral store.
   *
   * @param ephemeral - A TypedEphemeral store
   * @returns An object with `self` (your value) and `peers` (others' values)
   *
   * @example
   * ```tsx
   * const handle = useHandle(docId, DocSchema, { mouse: MouseSchema })
   * const { self, peers } = useEphemeral(handle.mouse)
   * ```
   */
  function useEphemeral<T>(ephemeral: TypedEphemeral<T>): {
    self: T | undefined
    peers: Map<string, T>
  } {
    // Use a ref to cache the snapshot
    const cacheRef = useRef<{
      self: T | undefined
      peers: Map<string, T>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      const computeValue = () => ({
        self: ephemeral.self,
        peers: ephemeral.peers,
      })

      // Initialize cache
      cacheRef.current = computeValue()

      const subscribe = (onStoreChange: () => void) => {
        return ephemeral.subscribe(() => {
          // Update cache on change
          cacheRef.current = computeValue()
          onStoreChange()
        })
      }

      const getSnapshot = () => {
        // Return cached value - it's updated in subscribe callback
        if (!cacheRef.current) {
          cacheRef.current = computeValue()
        }
        return cacheRef.current
      }

      return { subscribe, getSnapshot }
    }, [ephemeral])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  // ============================================
  // Exports
  // ============================================

  return {
    RepoContext,
    useRepo,
    useHandle,
    useDoc,
    usePresence,
    useEphemeral,
  }
}
