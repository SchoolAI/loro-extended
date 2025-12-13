import type { DocShape, Infer, ValueShape } from "@loro-extended/change"
import type { DocId, Repo, TypedDocHandle } from "@loro-extended/repo"

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

  // Overload: without presence
  function useHandle<D extends DocShape>(
    docId: DocId,
    docSchema: D,
  ): TypedDocHandle<D>

  // Overload: with presence
  function useHandle<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docSchema: D,
    presenceSchema: P,
  ): TypedDocHandle<D, P>

  // Implementation
  function useHandle<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docSchema: D,
    presenceSchema?: P,
  ): TypedDocHandle<D, P> | TypedDocHandle<D> {
    const repo = useRepo()

    // Synchronous initialization - no null state, no flickering
    const [handle] = useState(() => {
      if (presenceSchema) {
        return repo.get(docId, docSchema, presenceSchema)
      }
      return repo.get(docId, docSchema)
    })

    return handle
  }

  // ============================================
  // useDoc - Get document JSON snapshot (reactive)
  // ============================================

  // Overload: with selector (fine-grained)
  function useDoc<D extends DocShape, R>(
    handle: TypedDocHandle<D>,
    selector: (doc: Infer<D>) => R,
  ): R

  // Overload: without selector (full doc JSON)
  function useDoc<D extends DocShape>(handle: TypedDocHandle<D>): Infer<D>

  // Implementation
  function useDoc<D extends DocShape, R>(
    handle: TypedDocHandle<D>,
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
      const version = handle.untyped.doc.opCount()
      cacheRef.current = {
        version,
        value: computeValue(),
      }

      const subscribe = (onStoreChange: () => void) => {
        return handle.untyped.doc.subscribe(() => {
          // Update cache on change
          const newVersion = handle.untyped.doc.opCount()
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
        const currentVersion = handle.untyped.doc.opCount()
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

  function usePresence<D extends DocShape, P extends ValueShape>(
    handle: TypedDocHandle<D, P>,
  ): { self: Infer<P>; peers: Map<string, Infer<P>> } {
    // Use a ref to cache the snapshot
    const cacheRef = useRef<{
      self: Infer<P>
      peers: Map<string, Infer<P>>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      const computeValue = () => ({
        self: handle.presence.self,
        peers: handle.presence.peers,
      })

      // Initialize cache
      cacheRef.current = computeValue()

      const subscribe = (onStoreChange: () => void) => {
        return handle.presence.subscribe(() => {
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
    }, [handle])

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
  }
}
