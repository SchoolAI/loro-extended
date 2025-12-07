import {
  type DeepReadonly,
  type DocShape,
  type InferEmptyStateType,
  type InferPlainType,
  TypedDoc,
} from "@loro-extended/change"
import type { DocId } from "@loro-extended/repo"
import { useMemo } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

/**
 * Hook that provides schema-aware document state with empty state overlay.
 * Built on top of useDocHandleState following composition over inheritance.
 *
 * With the new simplified DocHandle architecture:
 * - Documents are always available once we have a handle
 * - We use the doc property (getter) instead of doc() method
 *
 * Follows SRP by handling only:
 * - TypedDoc integration with DocHandle
 * - Empty state overlay logic
 */
export function useTypedDocState<
  T extends DocShape,
  Result = InferPlainType<T>,
>(
  documentId: DocId,
  schema: T,
  emptyState: InferEmptyStateType<T>,
  selector?: (doc: DeepReadonly<InferPlainType<T>>) => Result,
) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Data transformation from Loro to JSON with empty state overlay
  // We include snapshot.version to trigger re-computation when the document changes
  const doc: Result = useMemo(() => {
    if (!handle) {
      // Return empty state immediately - no loading needed!
      const state = emptyState as unknown as DeepReadonly<InferPlainType<T>>
      return selector ? selector(state) : (state as unknown as Result)
    }

    // Access the doc via the getter property (not a method call)
    const loroDoc = handle.doc
    // Create a new TypedDoc with the same schema/emptyState but updated LoroDoc
    const updatedTypedDoc = new TypedDoc(schema, emptyState, loroDoc)

    // Use snapshot.version to ensure we re-compute when document changes
    void snapshot.version

    const value = updatedTypedDoc.value
    return selector ? selector(value) : (value as unknown as Result)
  }, [snapshot.version, handle, schema, emptyState, selector])

  return { doc, handle, snapshot }
}
