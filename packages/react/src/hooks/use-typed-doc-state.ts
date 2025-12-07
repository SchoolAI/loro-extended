import {
  type DeepReadonly,
  type DocShape,
  derivePlaceholder,
  type Infer,
  TypedDoc,
} from "@loro-extended/change"
import type { DocId } from "@loro-extended/repo"
import { useMemo } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

/**
 * Hook that provides schema-aware document state with placeholder overlay.
 * Built on top of useDocHandleState following composition over inheritance.
 *
 * With the new simplified DocHandle architecture:
 * - Documents are always available once we have a handle
 * - We use the doc property (getter) instead of doc() method
 *
 * Follows SRP by handling only:
 * - TypedDoc integration with DocHandle
 * - Placeholder overlay logic
 */
export function useTypedDocState<T extends DocShape, Result = Infer<T>>(
  documentId: DocId,
  schema: T,
  selector?: (doc: DeepReadonly<Infer<T>>) => Result,
) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Derive placeholder from schema (memoized) - used for initial state before handle is ready
  const placeholder = useMemo(() => derivePlaceholder(schema), [schema])

  // Data transformation from Loro to JSON with placeholder overlay
  // We include snapshot.version to trigger re-computation when the document changes
  const doc: Result = useMemo(() => {
    if (!handle) {
      // Return placeholder immediately - no loading needed!
      const state = placeholder as unknown as DeepReadonly<Infer<T>>
      return selector ? selector(state) : (state as unknown as Result)
    }

    // Access the doc via the getter property (not a method call)
    const loroDoc = handle.doc
    // Create a new TypedDoc - placeholder is derived automatically from schema
    const updatedTypedDoc = new TypedDoc(schema, loroDoc)

    // Use snapshot.version to ensure we re-compute when document changes
    void snapshot.version

    const value = updatedTypedDoc.value
    return selector ? selector(value) : (value as unknown as Result)
  }, [snapshot.version, handle, schema, placeholder, selector])

  return { doc, handle, snapshot }
}
