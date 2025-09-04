import type { DocHandle } from "@loro-extended/repo"
import type { LoroDoc } from "loro-crdt"
import { useCallback } from "react"
import type { DocWrapper } from "./use-doc-handle-state.js"

/** A function that mutates a raw LoroDoc directly. */
export type SimpleChangeFn = (doc: LoroDoc) => void

/** A function that transforms a LoroDoc before applying changes. */
export type DocTransformer<TInput> = (doc: LoroDoc) => TInput

/**
 * Unified hook that provides document mutation capabilities.
 * Supports both simple (direct LoroDoc) and transformed (schema-aware) mutations.
 *
 * Follows SRP by handling only:
 * - Handle validation
 * - Change function invocation
 * - Optional document transformation
 */
export function useDocChanger<TInput = LoroDoc>(
  handle: DocHandle<DocWrapper> | null,
  transformer?: DocTransformer<TInput>,
) {
  return useCallback(
    (fn: (input: TInput) => void) => {
      if (!handle) {
        console.warn("doc handle not available for change")
        return
      }

      handle.change(loroDoc => {
        const input = transformer
          ? transformer(loroDoc as LoroDoc)
          : (loroDoc as TInput)
        fn(input)
      })
    },
    [handle, transformer],
  )
}

/**
 * Simple document changer that works directly with LoroDoc.
 * Built on top of useDocChanger for consistency.
 */
export function useSimpleDocChanger(handle: DocHandle<DocWrapper> | null) {
  return useDocChanger<LoroDoc>(handle)
}
