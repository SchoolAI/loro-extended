import {
  type DocShape,
  type InferEmptyStateType,
  type InferPlainType,
  TypedDoc,
} from "@loro-extended/change"
import type { DocId } from "@loro-extended/repo"
import { useMemo } from "hono/jsx"
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
export function useTypedDocState<T extends DocShape>(
  documentId: DocId,
  schema: T,
  emptyState: InferEmptyStateType<T>,
) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Data transformation from Loro to JSON with empty state overlay
  // We include snapshot.version to trigger re-computation when the document changes
  const doc: InferPlainType<T> = useMemo(() => {
    if (!handle) {
      // Return empty state immediately - no loading needed!
      return emptyState as InferPlainType<T>
    }

    // Access the doc via the getter property (not a method call)
    const loroDoc = handle.doc
    // Create a new TypedDoc with the same schema/emptyState but updated LoroDoc
    const updatedTypedDoc = new TypedDoc(schema, emptyState, loroDoc)

    // Use snapshot.version to ensure we re-compute when document changes
    void snapshot.version

    return updatedTypedDoc.value
  }, [snapshot.version, handle, schema, emptyState])

  return { doc, handle, snapshot }
}
