import {
  type DocShape,
  type Infer,
  loro,
  type TypedDoc,
} from "@loro-extended/change"
import type { Lens, LensOptions } from "@loro-extended/lens"
import { createLens } from "@loro-extended/lens"
import type {
  Doc,
  DocId,
  EphemeralDeclarations,
  Repo,
  TypedEphemeral,
} from "@loro-extended/repo"
import type { LoroDoc } from "loro-crdt"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"

/**
 * Creates the core hooks for Loro collaborative editing.
 * These hooks provide repository context, document access, and ephemeral state.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing RepoContext, useRepo, useDocument, useLens, and useEphemeral
 */
export function createHooks(framework: FrameworkHooks) {
  const { useMemo, useRef, useSyncExternalStore, useContext, createContext } =
    framework

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
  // useDocument - Get typed document (PRIMARY API)
  // ============================================

  /**
   * Get a typed document by ID and schema.
   *
   * This is the primary hook for accessing documents. Returns a `Doc<D>` which
   * is a TypedDoc with sync capabilities accessible via `sync(doc)`.
   *
   * The document is cached by the Repo, so multiple calls with the same docId
   * return the same instance. This makes it safe to call without memoization.
   *
   * @param docId - The document ID
   * @param docSchema - The document schema
   * @param ephemeralShapes - Optional ephemeral store declarations
   * @returns A Doc with typed document access
   *
   * @example
   * ```tsx
   * import { useDocument, useValue } from "@loro-extended/react"
   * import { sync } from "@loro-extended/repo"
   *
   * function MyComponent() {
   *   const doc = useDocument("my-doc", MySchema)
   *   const title = useValue(doc.title)
   *
   *   // Direct mutations
   *   const handleClick = () => {
   *     doc.title.insert(0, "Hello")
   *   }
   *
   *   // Access sync capabilities
   *   const peerId = sync(doc).peerId
   *
   *   return <div>{title}</div>
   * }
   * ```
   */
  // Overload: without ephemeral stores - returns Doc<D>
  function useDocument<D extends DocShape>(docId: DocId, docSchema: D): Doc<D>

  // Overload: with ephemeral stores - returns Doc<D, E> for type inference in sync()
  function useDocument<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes: E,
  ): Doc<D, E>

  // Implementation
  function useDocument<D extends DocShape, E extends EphemeralDeclarations>(
    docId: DocId,
    docSchema: D,
    ephemeralShapes?: E,
  ): Doc<D, E> {
    const repo = useRepo()

    // repo.get() is cached, so we can call it directly without useState
    // This ensures we always get the same Doc instance for the same docId
    const doc = useMemo(() => {
      if (ephemeralShapes) {
        return repo.get(docId, docSchema, ephemeralShapes)
      }
      // When no ephemeralShapes, E defaults to Record<string, never> via overload
      // The cast is safe because the overloads ensure correct return types
      return repo.get(docId, docSchema) as Doc<D, E>
    }, [repo, docId, docSchema, ephemeralShapes])

    return doc
  }

  // ============================================
  // useLens - Create lens + Get worldview snapshot (reactive)
  // ============================================

  // Helper to create a version key that changes on checkout
  // This combines opCount (changes on edits) with frontiers (changes on checkout)
  function getVersionKey(loroDoc: LoroDoc): string {
    const opCount = loroDoc.opCount()
    const frontiers = loroDoc.frontiers()
    // Serialize frontiers to a stable string
    const frontiersKey = frontiers
      .map(f => `${f.peer}:${f.counter}`)
      .sort()
      .join(",")
    return `${opCount}|${frontiersKey}`
  }

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
   * // With useDocument and sync()
   * import { sync } from "@loro-extended/repo"
   *
   * const doc = useDocument(docId, DocSchema, { presence: PresenceSchema })
   * const { self, peers } = useEphemeral(sync(doc).presence)
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
    useDocument,
    useLens,
    useEphemeral,
  }
}
