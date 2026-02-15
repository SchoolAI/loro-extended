import type {
  AnyContainerShape,
  ContainerShape,
  DocShape,
  Infer,
  TypedDoc,
} from "@loro-extended/change"
import { loro } from "@loro-extended/change"
import type { Container, LoroDoc } from "loro-crdt"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"
import {
  getPlaceholder,
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

/**
 * Return type for useRefValue hook (deprecated).
 *
 * Returns an object with:
 * - `value`: The current JSON value of the ref (via `toJSON()`)
 * - `placeholder`: Optional placeholder value if defined in the shape
 *
 * @deprecated Use `useValue(ref)` for value and `usePlaceholder(ref)` for placeholder instead.
 */
export type UseRefValueReturn<R extends AnyTypedRef> = {
  /** The current value (from ref.toJSON()) */
  value: ReturnType<R["toJSON"]>
  /** The placeholder value, if defined in the shape */
  placeholder?: ReturnType<R["toJSON"]>
}

// ============================================================================
// Helper to check if something is a TypedDoc
// ============================================================================

/**
 * Check if a value is a TypedDoc (has toJSON and the EXT_SYMBOL).
 * TypedDocs have a specific structure that distinguishes them from refs.
 */
function isTypedDoc(value: unknown): value is TypedDoc<DocShape> {
  if (!value || typeof value !== "object") return false
  // TypedDocs have toJSON and are created with specific shape properties
  // We check for the loro symbol which is present on TypedDocs
  const loroSymbol = Symbol.for("loro-extended:loro")
  return loroSymbol in value && hasToJSON(value)
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
 * @returns Object containing useValue, usePlaceholder, and useRefValue hooks
 */
export function createRefHooks(framework: FrameworkHooks) {
  const { useRef, useMemo, useSyncExternalStore } = framework

  // ============================================
  // useValue - Subscribe to value (NEW PRIMARY API)
  // ============================================

  /**
   * Subscribe to a ref's or doc's value reactively.
   * Returns the value directly (not wrapped in an object).
   *
   * This is the primary hook for reactive subscriptions.
   *
   * @param refOrDoc - A typed ref (TextRef, ListRef, etc.) or a Doc
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
   * @example Subscribe to whole doc
   * ```tsx
   * function DocSnapshot({ doc }: { doc: Doc<MySchema> }) {
   *   const snapshot = useValue(doc)
   *   return <pre>{JSON.stringify(snapshot, null, 2)}</pre>
   * }
   * ```
   */
  // Overload: for typed refs
  function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>

  // Overload: for TypedDoc/Doc
  function useValue<D extends DocShape>(doc: TypedDoc<D>): Infer<D>

  // Implementation
  function useValue<R extends AnyTypedRef, D extends DocShape>(
    refOrDoc: R | TypedDoc<D>,
  ): ReturnType<R["toJSON"]> | Infer<D> {
    // Check if it's a TypedDoc
    const isDoc = isTypedDoc(refOrDoc)

    // Get the loro container/doc for subscription
    const loroTarget = useMemo(() => {
      if (isDoc) {
        return getLoroDoc(refOrDoc as TypedDoc<D>)
      }
      return loro(refOrDoc as Parameters<typeof loro>[0]) as Container
    }, [refOrDoc, isDoc])

    // Cache ref for the sync store
    const cacheRef = useRef<{ version?: string; value: unknown } | null>(null)

    const store = useMemo(() => {
      const computeValue = (): { version?: string; value: unknown } => {
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
        if (isDoc) {
          return (loroTarget as LoroDoc).subscribe(() => onChange())
        }
        return (loroTarget as Container).subscribe(onChange)
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [refOrDoc, loroTarget, isDoc])

    const result = useSyncExternalStore(store.subscribe, store.getSnapshot)
    return result.value as ReturnType<R["toJSON"]> | Infer<D>
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

  // ============================================
  // useRefValue - DEPRECATED
  // ============================================

  /**
   * @deprecated Use `useValue(ref)` for value and `usePlaceholder(ref)` for placeholder.
   *
   * Migration:
   * ```tsx
   * // Before
   * const { value, placeholder } = useRefValue(doc.title)
   *
   * // After
   * const value = useValue(doc.title)
   * const placeholder = usePlaceholder(doc.title)
   * ```
   *
   * @param ref - A typed ref (TextRef, ListRef, CounterRef, etc.)
   * @returns Object with the current value and placeholder (if applicable)
   */
  function useRefValue<R extends AnyTypedRef>(ref: R): UseRefValueReturn<R> {
    // Emit deprecation warning in development
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).__LORO_DEV_WARNINGS__ !== false
    ) {
      console.warn(
        "[loro-extended] useRefValue is deprecated. " +
          "Use useValue(ref) for value and usePlaceholder(ref) for placeholder.",
      )
    }

    // Get the loro container for subscription
    const loroRef = useMemo(
      () => loro(ref as Parameters<typeof loro>[0]) as Container,
      [ref],
    )

    // Cache ref for the sync store
    const cacheRef = useRef<UseRefValueReturn<R> | null>(null)

    const store = useMemo(() => {
      // Compute the current value
      const computeValue = (): UseRefValueReturn<R> => {
        // For TextRef, use raw CRDT value to avoid placeholder overlay
        if (isTextRef(ref)) {
          const value = getRawTextValue(ref)
          const placeholder = getPlaceholder<string>(ref)
          if (placeholder) {
            return { value, placeholder } as UseRefValueReturn<R>
          }
          return { value } as UseRefValueReturn<R>
        }

        // For other ref types, use toJSON()
        if (hasToJSON(ref)) {
          const value = ref.toJSON()
          const placeholder = getPlaceholder(ref)
          if (placeholder) {
            return { value, placeholder } as UseRefValueReturn<R>
          }
          return { value } as UseRefValueReturn<R>
        }

        throw new Error(
          "[useRefValue] Ref does not have a toJSON method. This is likely a bug.",
        )
      }

      // Subscribe to container changes
      const subscribeToSource = (onChange: () => void) => {
        return loroRef.subscribe(onChange)
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [ref, loroRef])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  return { useValue, usePlaceholder, useRefValue }
}
