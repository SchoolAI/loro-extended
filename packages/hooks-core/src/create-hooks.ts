import {
  type DocShape,
  type Infer,
  loro,
  type TypedDoc,
} from "@loro-extended/change"
import type { Lens, LensOptions } from "@loro-extended/lens"
import { createLens } from "@loro-extended/lens"
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

  // Helper to create a version key that changes on checkout
  // This combines opCount (changes on edits) with frontiers (changes on checkout)
  function getVersionKey(
    loroDoc: Handle<DocShape, EphemeralDeclarations>["loroDoc"],
  ): string {
    const opCount = loroDoc.opCount()
    const frontiers = loroDoc.frontiers()
    // Serialize frontiers to a stable string
    const frontiersKey = frontiers
      .map(f => `${f.peer}:${f.counter}`)
      .sort()
      .join(",")
    return `${opCount}|${frontiersKey}`
  }

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
      version: string
      value: R | Infer<D>
    } | null>(null)

    const store = useMemo(() => {
      // Compute the current snapshot value
      // Optimization: Check version first to avoid unnecessary toJSON() calls
      // Version includes both opCount and frontiers to detect checkout changes
      const computeValue = (): { version: string; value: R | Infer<D> } => {
        const newVersion = getVersionKey(handle.loroDoc)

        // If we have a cached value with the same version, return it
        // This avoids expensive toJSON() calls when the document hasn't changed
        if (cacheRef.current && cacheRef.current.version === newVersion) {
          return cacheRef.current
        }

        // Version changed or no cache - compute new value
        const json = handle.doc.toJSON()
        return {
          version: newVersion,
          value: selector ? selector(json) : json,
        }
      }

      // Subscribe to document changes
      // Note: We always call onChange() and let createSyncStore handle the caching.
      // The version check in computeValue() will prevent unnecessary re-renders.
      const subscribeToSource = (onChange: () => void) => {
        return handle.loroDoc.subscribe(() => {
          onChange()
        })
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [handle, selector])

    const result = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return result.value
  }

  // ============================================
  // useLens - Create lens + Get worldview snapshot (reactive)
  // ============================================

  function useLens<D extends DocShape>(
    world: TypedDoc<D>,
    options?: LensOptions,
  ): { lens: Lens<D>; doc: Infer<D> }

  function useLens<D extends DocShape, R>(
    world: TypedDoc<D>,
    options: LensOptions | undefined,
    selector: (doc: Infer<D>) => R,
  ): { lens: Lens<D>; doc: R }

  function useLens<D extends DocShape, R>(
    world: TypedDoc<D>,
    options?: LensOptions,
    selector?: (doc: Infer<D>) => R,
  ): { lens: Lens<D>; doc: R | Infer<D> } {
    const lensRef = useRef<Lens<D> | null>(null)

    const lens = useMemo(() => {
      lensRef.current?.dispose()
      const nextLens = createLens(world, options)
      lensRef.current = nextLens
      return nextLens
    }, [world, options])

    framework.useEffect(() => {
      return () => {
        lensRef.current?.dispose()
        lensRef.current = null
      }
    }, [])

    const cacheRef = useRef<{
      version: string
      value: R | Infer<D>
    } | null>(null)

    const store = useMemo(() => {
      const computeValue = (): { version: string; value: R | Infer<D> } => {
        const newVersion = getVersionKey(loro(lens.worldview))

        if (cacheRef.current && cacheRef.current.version === newVersion) {
          return cacheRef.current
        }

        const json = lens.worldview.toJSON()
        return {
          version: newVersion,
          value: selector ? selector(json) : json,
        }
      }

      const subscribeToSource = (onChange: () => void) => {
        return loro(lens.worldview).subscribe(() => {
          onChange()
        })
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [lens, selector])

    const result = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return { lens, doc: result.value }
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
    useLens,
    useEphemeral,
  }
}
