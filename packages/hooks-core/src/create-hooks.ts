import type { DocShape, Infer } from "@loro-extended/change"
import type {
  DocId,
  EphemeralDeclarations,
  Handle,
  HandleWithEphemerals,
  Repo,
  TypedEphemeral,
} from "@loro-extended/repo"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"

/**
 * Creates the core hooks for Loro collaborative editing.
 * These hooks provide repository context, document access, and ephemeral state.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing RepoContext, useRepo, useHandle, useDoc, and useEphemeral
 */
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
      const computeValue = (): { version: number; value: R | Infer<D> } => {
        const json = handle.doc.toJSON()
        return {
          version: handle.loroDoc.opCount(),
          value: selector ? selector(json) : json,
        }
      }

      // Subscribe to document changes
      const subscribeToSource = (onChange: () => void) => {
        return handle.loroDoc.subscribe(() => {
          const newVersion = handle.loroDoc.opCount()
          if (!cacheRef.current || cacheRef.current.version !== newVersion) {
            onChange()
          }
        })
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [handle, selector])

    const result = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return result.value
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

      // Subscribe to ephemeral changes
      const subscribeToSource = (onChange: () => void) => {
        return ephemeral.subscribe(onChange)
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
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
    useEphemeral,
  }
}
