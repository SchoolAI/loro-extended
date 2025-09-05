import type { InferInputType, LoroDocSchema } from "@loro-extended/change"
import type { DocHandle, DocumentId } from "@loro-extended/repo"
import type { DocWrapper } from "./use-doc-handle-state.js"
import type { ChangeFn } from "./use-typed-doc-changer.js"
import { useTypedDocChanger } from "./use-typed-doc-changer.js"
import { useTypedDocState } from "./use-typed-doc-state.js"

/** The return type of the `useDocument` hook. */
export type UseDocumentReturn<T extends LoroDocSchema> = [
  /** The current state of the document (always defined due to empty state overlay). */
  doc: InferInputType<T>,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The DocHandle instance that provides access to the underlying LoroDoc and state. */
  handle: DocHandle<DocWrapper> | null,
]

/**
 * A hook that provides a reactive interface to a Loro document handle with schema-based typing.
 * You can think of it as similar to `useState`, but for schema-aware LoroDoc.
 *
 * The document is always available (never undefined) due to empty state overlay - even before
 * the handle is ready, the hook returns the empty state so components can render immediately.
 *
 * Returns a tuple containing the document's data, a function to modify it,
 * and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const schema = LoroShape.doc({
 *   title: LoroShape.text(),
 *   todos: LoroShape.list(z.object({
 *     id: z.string(),
 *     text: z.string(),
 *     done: z.boolean()
 *   }))
 * })
 *
 * const emptyState = {
 *   title: "My Todos",
 *   todos: []
 * }
 *
 * const [doc, changeDoc, handle] = useDocument(documentId, schema, emptyState)
 *
 * // doc is always defined! No loading check needed
 * return (
 *  <div>
 *    {handle?.state === "loading" && <div>Syncing...</div>}
 *    <p>{doc.title}</p>
 *    <button onClick={() => changeDoc(draft => {
 *      draft.title.insert(0, "📝 ")
 *      draft.todos.push({ id: "1", text: "New Todo", done: false })
 *    })}>
 *      Update Document
 *    </button>
 *  </div>
 * )
 * ```
 */
export function useDocument<T extends LoroDocSchema>(
  documentId: DocumentId,
  schema: T,
  emptyState: InferInputType<T>,
): UseDocumentReturn<T> {
  const { doc, handle } = useTypedDocState<T>(documentId, schema, emptyState)
  const changeDoc = useTypedDocChanger<T>(handle, schema, emptyState)

  return [doc, changeDoc, handle]
}
