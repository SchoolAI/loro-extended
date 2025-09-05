import {
  createTypedDoc,
  type InferInputType,
  type LoroDocSchema,
} from "@loro-extended/change"
import type { DocumentId } from "@loro-extended/repo"
import { useMemo } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

/**
 * Hook that provides schema-aware document state with empty state overlay.
 * Built on top of useDocHandleState following composition over inheritance.
 *
 * Follows SRP by handling only:
 * - Schema-based data transformation
 * - Empty state overlay logic
 */
export function useTypedDocState<T extends LoroDocSchema>(
  documentId: DocumentId,
  schema: T,
  emptyState: InferInputType<T>,
) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Data transformation from Loro to JSON with empty state overlay
  const doc = useMemo(() => {
    if (snapshot.state !== "ready" || !handle) {
      // Return empty state immediately - no loading needed!
      return emptyState
    }

    const loroDoc = handle.doc()
    // Create typed document and return value with empty state overlay
    const typedDoc = createTypedDoc(schema, emptyState, loroDoc as any)
    return typedDoc.value
  }, [snapshot, handle, schema, emptyState])

  return { doc: doc as InferInputType<T>, handle, snapshot }
}
