import type {
  AnyContainerShape,
  ContainerShape,
  DocShape,
  Infer,
  PlainValueRef,
  TypedDoc,
} from "@loro-extended/change"
import { isPlainValueRef, loro } from "@loro-extended/change"
import type { Container, LoroDoc } from "loro-crdt"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"
import {
  getPlaceholder,
  getPlainValueRefValue,
  getRawTextValue,
  isTextRef,
} from "./utils/text-ref-helpers"
import { hasToJSON } from "./utils/type-guards"

// ============================================================================
// Type definitions for ref types
// ============================================================================

/**
 * Union of all typed ref types that useValue can accept.
 *
 * Derived from `ContainerShape["_mutable"]`, excluding `AnyContainerShape`
 * which is an escape hatch that doesn't create typed refs.
 *
 * This includes: TextRef, CounterRef, ListRef, MovableListRef, RecordRef,
 * StructRef, and TreeRefInterface.
 */
export type AnyTypedRef = Exclude<ContainerShape, AnyContainerShape>["_mutable"]

// ============================================================================
// Helper to check if something is a TypedDoc
// ============================================================================

/**
 * Check if a value is a TypedDoc (has toJSON and the EXT_SYMBOL with docShape).
 * TypedDocs have a specific structure that distinguishes them from refs.
 * Both TypedDocs and refs have LORO_SYMBOL, but only TypedDocs have docShape in EXT_SYMBOL.
 */
function isTypedDoc(value: unknown): value is TypedDoc<DocShape> {
  if (!value || typeof value !== "object") return false
  // TypedDocs have an EXT_SYMBOL namespace containing docShape
  // Refs also have LORO_SYMBOL but don't have docShape in their EXT namespace
  const extSymbol = Symbol.for("loro-extended:ext")
  const extNs = (value as Record<symbol, unknown>)[extSymbol]
  return (
    !!extNs &&
    typeof extNs === "object" &&
    "docShape" in extNs &&
    hasToJSON(value)
  )
}

/**
 * Get the LoroDoc from a TypedDoc using the loro() escape hatch.
 */
function getLoroDoc(doc: TypedDoc<DocShape>): LoroDoc {
  return loro(doc)
}

/**
 * Get version key for a LoroDoc (for change detection).
 */
function getVersionKey(loroDoc: LoroDoc): string {
  const opCount = loroDoc.opCount()
  const frontiers = loroDoc.frontiers()
  const frontiersKey = frontiers
    .map(f => `${f.peer}:${f.counter}`)
    .sort()
    .join(",")
  return `${opCount}|${frontiersKey}`
}

// ============================================================================
// createRefHooks factory
// ============================================================================

/**
 * Creates ref-level hooks for subscribing to individual typed refs and docs.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing useValue and usePlaceholder hooks
 */
export function createRefHooks(framework: FrameworkHooks) {
  const { useRef, useMemo, useSyncExternalStore } = framework

  // ============================================
  // useValue - Subscribe to value (PRIMARY API)
  // ============================================

  /**
   * Subscribe to a ref's or doc's value reactively.
   * Returns the value directly (not wrapped in an object).
   *
   * This is the primary hook for reactive subscriptions.
   *
   * @param refOrDoc - A typed ref (TextRef, ListRef, etc.), PlainValueRef, or a Doc
   * @returns The current value
   *
   * @example Subscribe to a ref
   * ```tsx
   * function TitleDisplay({ doc }: { doc: Doc<MySchema> }) {
   *   const title = useValue(doc.title)
   *   return <h1>{title}</h1>
   * }
   * ```
   *
   * @example Subscribe to a plain value property
   * ```tsx
   * function StatusDisplay({ doc }: { doc: Doc<MySchema> }) {
   *   // doc.meta.active returns PlainValueRef<boolean> outside change()
   *   const active = useValue(doc.meta.active)
   *   return <span>{active ? "Active" : "Inactive"}</span>
   * }
   * ```
   *
   * @example Subscribe to whole doc
   * ```tsx
   * function DocSnapshot({ doc }: { doc: Doc<MySchema> }) {
   *   const snapshot = useValue(doc)
   *   return <pre>{JSON.stringify(snapshot, null, 2)}</pre>
   * }
   * ```
   *
   * @example Handle optional refs (nullish support)
   * ```tsx
   * function PlayerChoice({ doc }: { doc: Doc<GameSchema> }) {
   *   // record.get() returns PlainValueRef<T> | undefined
   *   const player = doc.players.get("alice")
   *   const playerData = useValue(player)  // T | undefined
   *   return <div>{playerData?.choice ?? "No choice"}</div>
   * }
   * ```
   */

  // ============================================================================
  // Non-nullish overloads (most specific - must come FIRST)
  // TypeScript picks the first matching overload, so specific types must precede unions
  // ============================================================================

  // Overload: for PlainValueRef (must come FIRST for proper overload resolution)
  function useValue<T>(ref: PlainValueRef<T>): T

  // Overload: for typed refs
  function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>

  // Overload: for TypedDoc/Doc
  function useValue<D extends DocShape>(doc: TypedDoc<D>): Infer<D>

  // ============================================================================
  // Nullish overloads (less specific - must come AFTER non-nullish)
  // These handle optional chaining patterns like `useValue(record.get("key"))`
  // ============================================================================

  /**
   * Handle undefined input - returns undefined.
   * Enables patterns like `useValue(record.get("key"))` where get() may return undefined.
   */
  function useValue(ref: undefined): undefined

  /**
   * Handle null input - returns null.
   */
  function useValue(ref: null): null

  /**
   * Subscribe to a PlainValueRef that may be undefined.
   * Enables patterns like `useValue(record.get("key"))`.
   */
  function useValue<T>(ref: PlainValueRef<T> | undefined): T | undefined

  /**
   * Subscribe to a PlainValueRef that may be null.
   */
  function useValue<T>(ref: PlainValueRef<T> | null): T | null

  /**
   * Subscribe to a TypedRef that may be undefined.
   */
  function useValue<R extends AnyTypedRef>(
    ref: R | undefined,
  ): ReturnType<R["toJSON"]> | undefined

  /**
   * Subscribe to a TypedRef that may be null.
   */
  function useValue<R extends AnyTypedRef>(
    ref: R | null,
  ): ReturnType<R["toJSON"]> | null

  /**
   * Subscribe to a TypedDoc that may be undefined.
   */
  function useValue<D extends DocShape>(
    doc: TypedDoc<D> | undefined,
  ): Infer<D> | undefined

  /**
   * Subscribe to a TypedDoc that may be null.
   */
  function useValue<D extends DocShape>(
    doc: TypedDoc<D> | null,
  ): Infer<D> | null

  // Implementation
  function useValue<T, R extends AnyTypedRef, D extends DocShape>(
    refOrDoc: PlainValueRef<T> | R | TypedDoc<D> | null | undefined,
  ): T | ReturnType<R["toJSON"]> | Infer<D> | null | undefined {
    // Handle nullish inputs - preserve the nullishness
    const isNullish = refOrDoc === null || refOrDoc === undefined

    // Check if it's a PlainValueRef (only if not nullish)
    const isPlainRef = !isNullish && isPlainValueRef(refOrDoc)

    // Check if it's a TypedDoc (only if not nullish)
    const isDoc = !isNullish && !isPlainRef && isTypedDoc(refOrDoc)

    // Get the loro container/doc for subscription
    const loroTarget = useMemo(() => {
      if (isNullish) return null // No container to subscribe to
      if (isPlainRef) {
        // For PlainValueRef, get the parent container for subscription
        return getPlainValueRefValue(refOrDoc as PlainValueRef<T>).container
      }
      if (isDoc) {
        return getLoroDoc(refOrDoc as TypedDoc<D>)
      }
      return loro(refOrDoc as Parameters<typeof loro>[0]) as Container
    }, [refOrDoc, isPlainRef, isDoc, isNullish])

    // Cache ref for the sync store
    const cacheRef = useRef<{ version?: string; value: unknown } | null>(null)

    // Cached value for nullish inputs - must be stable to avoid infinite loops
    const nullishCacheRef = useRef<{ value: unknown } | null>(null)

    const store = useMemo(() => {
      // No-op store for nullish inputs
      if (isNullish) {
        // Cache the nullish value to avoid creating new objects on each getSnapshot call
        // This prevents React's useSyncExternalStore from detecting false changes
        if (
          nullishCacheRef.current === null ||
          nullishCacheRef.current.value !== refOrDoc
        ) {
          nullishCacheRef.current = { value: refOrDoc }
        }
        const cachedNullish = nullishCacheRef.current
        return {
          subscribe: (_onChange: () => void) => () => {}, // No-op unsubscribe
          getSnapshot: () => cachedNullish, // Return stable cached reference
        }
      }

      const computeValue = (): { version?: string; value: unknown } => {
        if (isPlainRef) {
          // For PlainValueRef, extract the current value
          const { value } = getPlainValueRefValue(refOrDoc as PlainValueRef<T>)
          return { value }
        }

        if (isDoc) {
          // For TypedDoc, use version-based caching
          const loroDoc = loroTarget as LoroDoc
          const newVersion = getVersionKey(loroDoc)

          if (cacheRef.current && cacheRef.current.version === newVersion) {
            return cacheRef.current
          }

          const value = (refOrDoc as TypedDoc<D>).toJSON()
          return { version: newVersion, value }
        }

        // For refs
        const ref = refOrDoc as R

        // For TextRef, use raw CRDT value to avoid placeholder overlay
        if (isTextRef(ref)) {
          const value = getRawTextValue(ref)
          return { value }
        }

        // For other ref types, use toJSON()
        if (hasToJSON(ref)) {
          const value = ref.toJSON()
          return { value }
        }

        throw new Error(
          "[useValue] Target does not have a toJSON method. This is likely a bug.",
        )
      }

      const subscribeToSource = (onChange: () => void) => {
        if (isPlainRef) {
          // For PlainValueRef, subscribe to the parent container
          return (loroTarget as Container).subscribe(onChange)
        }
        if (isDoc) {
          return (loroTarget as LoroDoc).subscribe(() => onChange())
        }
        return (loroTarget as Container).subscribe(onChange)
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [refOrDoc, loroTarget, isPlainRef, isDoc, isNullish])

    const result = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return result.value as
      | T
      | ReturnType<R["toJSON"]>
      | Infer<D>
      | null
      | undefined
  }

  // ============================================
  // usePlaceholder - Get placeholder value (rare)
  // ============================================

  /**
   * Get the placeholder value for a ref.
   *
   * This is a separate hook for the rare case when you need placeholder access.
   * Most components should just use `useValue(ref)` for the actual value.
   *
   * @param ref - A typed ref (TextRef, ListRef, etc.)
   * @returns The placeholder value, or undefined if not set
   *
   * @example
   * ```tsx
   * function TitleInput({ doc }: { doc: Doc<MySchema> }) {
   *   const title = useValue(doc.title)
   *   const placeholder = usePlaceholder(doc.title)
   *
   *   return (
   *     <input
   *       value={title}
   *       placeholder={placeholder ?? "Enter title..."}
   *       onChange={(e) => doc.title.update(e.target.value)}
   *     />
   *   )
   * }
   * ```
   */
  function usePlaceholder<R extends AnyTypedRef>(
    ref: R,
  ): ReturnType<R["toJSON"]> | undefined {
    // Placeholder is static - it doesn't change after schema definition
    // So we can just compute it once with useMemo
    return useMemo(() => {
      return getPlaceholder(ref) as ReturnType<R["toJSON"]> | undefined
    }, [ref])
  }

  return { useValue, usePlaceholder }
}
