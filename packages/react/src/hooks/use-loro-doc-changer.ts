import {
  createTypedDoc,
  type InferDraftType,
  type InferEmptyType,
  type LoroDocSchema,
} from "@loro-extended/change"
import { type DocHandle } from "@loro-extended/repo"
import { useCallback } from "react"
import type { DocWrapper } from "./use-loro-doc-state.js"

/** A function that mutates a Loro document using schema-aware drafts. */
export type ChangeFn<T extends LoroDocSchema> = (draft: InferDraftType<T>) => void

/**
 * Internal hook that provides document mutation capabilities.
 * Separated from state management for clear separation of read vs write operations.
 */
export function useLoroDocChanger<T extends LoroDocSchema>(
  handle: DocHandle<DocWrapper> | null,
  schema: T,
  emptyState: InferEmptyType<T>
) {
  return useCallback(
    (fn: ChangeFn<T>) => {
      if (!handle) {
        console.warn("doc handle not available for change")
        return
      }
      handle.change(loroDoc => {
        // Create a typed document from the schema, empty state, and existing LoroDoc
        // We need to access the underlying LoroDoc without the DocWrapper typing
        const typedDoc = createTypedDoc(schema, emptyState, loroDoc as any)
        typedDoc.change(fn)
      })
    },
    [handle, schema, emptyState],
  )
}