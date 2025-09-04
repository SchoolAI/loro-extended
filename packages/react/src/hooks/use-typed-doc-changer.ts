import {
  createTypedDoc,
  type InferDraftType,
  type InferEmptyType,
  type LoroDocSchema,
} from "@loro-extended/change"
import type { DocHandle } from "@loro-extended/repo"
import type { LoroDoc } from "loro-crdt"
import { useCallback } from "react"
import { useDocChanger } from "./use-doc-changer.js"
import type { DocWrapper } from "./use-doc-handle-state.js"

/** A function that mutates a Loro document using schema-aware drafts. */
export type ChangeFn<T extends LoroDocSchema> = (
  draft: InferDraftType<T>,
) => void

/**
 * Hook that provides schema-aware document mutation capabilities.
 * Built on top of useDocChanger following composition over inheritance.
 *
 * Follows SRP by handling only:
 * - Schema-aware document transformation
 * - Typed draft creation and mutation
 */
export function useTypedDocChanger<T extends LoroDocSchema>(
  handle: DocHandle<DocWrapper> | null,
  schema: T,
  emptyState: InferEmptyType<T>,
) {
  // Create a transformer that converts LoroDoc to typed draft
  const transformer = useCallback(
    (loroDoc: LoroDoc) => {
      const typedDoc = createTypedDoc(schema, emptyState, loroDoc)
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
