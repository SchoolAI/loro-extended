import {
  type DocShape,
  type Draft,
  type InferEmptyStateType,
  TypedDoc,
} from "@loro-extended/change"
import type { DocHandle } from "@loro-extended/repo"
import type { LoroDoc } from "loro-crdt"
import { useCallback } from "react"
import { useDocChanger } from "./use-doc-changer.js"
import type { DocWrapper } from "./use-doc-handle-state.js"

/** A function that mutates a Loro document using schema-aware drafts. */
export type ChangeFn<T extends DocShape> = (draft: Draft<T>) => void

/**
 * Hook that provides schema-aware document mutation capabilities.
 * Built on top of useDocChanger following composition over inheritance.
 *
 * Follows SRP by handling only:
 * - Schema-aware document transformation
 * - Typed draft creation and mutation
 */
export function useTypedDocChanger<T extends DocShape>(
  handle: DocHandle<DocWrapper> | null,
  schema: T,
  emptyState: InferEmptyStateType<T>,
) {
  // Create a transformer that converts LoroDoc to typed draft
  // Note: The loroDoc parameter is already the LoroDoc from handle.doc (property, not method)
  const transformer = useCallback(
    (loroDoc: LoroDoc) => {
      const typedDoc = new TypedDoc(schema, emptyState, loroDoc)
      return typedDoc
    },
    [schema, emptyState],
  )

  // Use the unified changer with our transformer
  const baseChanger = useDocChanger(handle, transformer)

  // Return a function that accepts schema-aware change functions
  return useCallback(
    (fn: ChangeFn<T>) => {
      baseChanger(typedDoc => {
        typedDoc.change(fn)
      })
    },
    [baseChanger],
  )
}
