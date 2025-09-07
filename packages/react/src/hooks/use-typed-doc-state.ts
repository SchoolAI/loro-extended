import {
  TypedDoc,
  type DocShape,
  type InferPlainType,
} from "@loro-extended/change"
import type { DocumentId } from "@loro-extended/repo"
import { useMemo } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

/**
 * Hook that provides schema-aware document state with empty state overlay.
 * Built on top of useDocHandleState following composition over inheritance.
 *
 * Follows SRP by handling only:
 * - TypedDoc integration with DocHandle
 * - Empty state overlay logic
 */
export function useTypedDocState<T extends DocShape>(
  documentId: DocumentId,
  schema: T,
  emptyState: InferPlainType<T>,
) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Data transformation from Loro to JSON with empty state overlay
  const doc = useMemo(() => {
    if (snapshot.state !== "ready" || !handle) {
      // Return empty state immediately - no loading needed!
      return emptyState
    }

    // Update the TypedDoc's underlying LoroDoc with the handle's doc
    const loroDoc = handle.doc()
    // Create a new TypedDoc with the same schema/emptyState but updated LoroDoc
    const updatedTypedDoc = new TypedDoc(schema, emptyState, loroDoc)
    return updatedTypedDoc.value
  }, [snapshot, handle, schema, emptyState])

  return { doc, handle, snapshot }
}
