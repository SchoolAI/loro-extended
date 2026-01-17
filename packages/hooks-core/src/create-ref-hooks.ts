import type {
  AnyContainerShape,
  ContainerShape,
  LoroRefBase,
} from "@loro-extended/change"
import { loro } from "@loro-extended/change"
import type { FrameworkHooks } from "./types"
import { createSyncStore } from "./utils/create-sync-store"
import {
  getPlaceholder,
  getRawTextValue,
  isTextRef,
} from "./utils/text-ref-helpers"

// ============================================================================
// Type definitions for useRefValue return types
// ============================================================================

/**
 * Union of all typed ref types that useRefValue can accept.
 *
 * Derived from `ContainerShape["_mutable"]`, excluding `AnyContainerShape`
 * which is an escape hatch that doesn't create typed refs.
 *
 * This includes: TextRef, CounterRef, ListRef, MovableListRef, RecordRef,
 * StructRef, and TreeRefInterface.
 */
export type AnyTypedRef = Exclude<ContainerShape, AnyContainerShape>["_mutable"]

/**
 * Return type for useRefValue hook.
 *
 * Returns an object with:
 * - `value`: The current JSON value of the ref (via `toJSON()`)
 * - `placeholder`: Optional placeholder value if defined in the shape
 *
 * This unified type replaces the previous 8-level conditional chain.
 * All refs return the same structure - the value type is inferred from
 * the ref's `toJSON()` return type.
 */
export type UseRefValueReturn<R extends AnyTypedRef> = {
  /** The current value (from ref.toJSON()) */
  value: ReturnType<R["toJSON"]>
  /** The placeholder value, if defined in the shape */
  placeholder?: ReturnType<R["toJSON"]>
}

// ============================================================================
// createRefHooks factory
// ============================================================================

/**
 * Creates ref-level hooks for subscribing to individual typed refs.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing useRefValue hook
 */
export function createRefHooks(framework: FrameworkHooks) {
  const { useRef, useMemo, useSyncExternalStore } = framework

  /**
   * Hook for subscribing to a single typed ref's value.
   * Provides fine-grained reactivity - only re-renders when this specific container changes.
   *
   * @param ref - A typed ref (TextRef, ListRef, CounterRef, etc.)
   * @returns Object with the current value and placeholder (if applicable)
   *
   * @example
   * ```tsx
   * function TitleInput({ textRef }: { textRef: TextRef }) {
   *   const { value, placeholder } = useRefValue(textRef)
   *
   *   return (
   *     <input
   *       value={value}
   *       placeholder={placeholder}
   *       onChange={(e) => textRef.update(e.target.value)}
   *     />
   *   )
   * }
   * ```
   *
   * @example
   * ```tsx
   * function ItemCount({ listRef }: { listRef: ListRef<ItemShape> }) {
   *   const { value } = useRefValue(listRef)
   *   return <span>{value.length} items</span>
   * }
   * ```
   */
  function useRefValue<R extends AnyTypedRef>(ref: R): UseRefValueReturn<R> {
    // Get the loro namespace for subscription
    const loroRef = useMemo(() => loro(ref as any) as LoroRefBase, [ref])

    // Cache ref for the sync store
    const cacheRef = useRef<UseRefValueReturn<R> | null>(null)

    const store = useMemo(() => {
      // Compute the current value
      const computeValue = (): UseRefValueReturn<R> => {
        // For TextRef, use raw CRDT value to avoid placeholder overlay
        // This is consistent with useCollaborativeText behavior
        if (isTextRef(ref)) {
          const value = getRawTextValue(ref)
          const placeholder = getPlaceholder<string>(ref)
          // Only include placeholder if it's a non-empty string
          // (undefined or empty string means no placeholder was set)
          if (placeholder) {
            return { value, placeholder } as UseRefValueReturn<R>
          }
          return { value } as UseRefValueReturn<R>
        }

        // For other ref types, use toJSON()
        const value = (ref as any).toJSON()
        const placeholder = getPlaceholder(ref)

        // Only include placeholder if it's defined and truthy
        if (placeholder) {
          return { value, placeholder } as UseRefValueReturn<R>
        }
        return { value } as UseRefValueReturn<R>
      }

      // Subscribe to container changes
      const subscribeToSource = (onChange: () => void) => {
        return loroRef.subscribe(onChange)
      }

      return createSyncStore(computeValue, subscribeToSource, cacheRef)
    }, [ref, loroRef])

    return useSyncExternalStore(store.subscribe, store.getSnapshot)
  }

  return { useRefValue }
}
