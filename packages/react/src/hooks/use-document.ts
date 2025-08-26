import type { DocHandle, DocumentId } from "@loro-extended/repo"
import type { ChangeFn } from "./use-loro-doc-changer.js"
import { useLoroDocChanger } from "./use-loro-doc-changer.js"
import type { DocWrapper } from "./use-loro-doc-state.js"
import { useLoroDocState } from "./use-loro-doc-state.js"

/** The return type of the `useDocument` hook. */
export type UseDocumentReturn<T extends object> = [
  /** The current state of the document, or undefined if not ready. */
  doc: T | undefined,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The DocHandle instance that provides access to the underlying LoroDoc and state. */
  handle: DocHandle<DocWrapper> | null,
]

/**
 * A hook that provides a reactive interface to a Loro document handle. You
 * can think of it as similar to `useState`, but for LoroDoc.
 *
 * Returns a tuple containing the document's data, a function to modify it,
 * and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const [doc, changeDoc, handle] = useDocument(documentId)
 *
 * if (!doc) {
 *   return <Loading />
 * }
 *
 * return (
 *  <div>
 *    <p>{doc.title}</p>
 *    <button onClick={() => changeDoc(d => d.title = "New Title")}>
 *      Change Title
 *    </button>
 *  </div>
 * )
 * ```
 */
export function useDocument<T extends object>(
  documentId: DocumentId,
): UseDocumentReturn<T> {
  const { doc, handle } = useLoroDocState<T>(documentId)
  const changeDoc = useLoroDocChanger<T>(handle)

  return [doc, changeDoc, handle]
}
