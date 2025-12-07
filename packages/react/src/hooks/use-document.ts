import type { DeepReadonly, DocShape, Infer } from "@loro-extended/change"
import type { DocHandle, DocId } from "@loro-extended/repo"
import type { DocWrapper } from "./use-doc-handle-state.js"
import type { ChangeFn } from "./use-typed-doc-changer.js"
import { useTypedDocChanger } from "./use-typed-doc-changer.js"
import { useTypedDocState } from "./use-typed-doc-state.js"

/** The return type of the `useDocument` hook. */
export type UseDocumentReturn<T extends DocShape, Result = Infer<T>> = [
  /** The current state of the document (always defined due to placeholder overlay). */
  doc: Result,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The DocHandle instance that provides access to the underlying LoroDoc and state. */
  handle: DocHandle<DocWrapper> | null,
]

/**
 * A hook that provides a reactive interface to a Loro document handle with schema-based typing.
 * You can think of it as similar to `useState`, but for schema-aware LoroDoc.
 *
 * The document is always available (never undefined) due to placeholder overlay - even before
 * the handle is ready, the hook returns the placeholder so components can render immediately.
 *
 * Placeholder values are automatically derived from the schema. Use `.placeholder()` on
 * individual shapes to customize default values.
 *
 * Returns a tuple containing the document's data, a function to modify it,
 * and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const schema = Shape.doc({
 *   title: Shape.text().placeholder("My Todos"),
 *   todos: Shape.list(Shape.plain.object({
 *     id: Shape.plain.string(),
 *     text: Shape.plain.string(),
 *     done: Shape.plain.boolean()
 *   }))
 * })
 *
 * const [doc, changeDoc, handle] = useDocument(documentId, schema)
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
export function useDocument<T extends DocShape, Result = Infer<T>>(
  documentId: DocId,
  schema: T,
  selector?: (doc: DeepReadonly<Infer<T>>) => Result,
): UseDocumentReturn<T, Result> {
  const { doc, handle } = useTypedDocState<T, Result>(
    documentId,
    schema,
    selector,
  )
  const changeDoc = useTypedDocChanger<T>(handle, schema)

  return [doc, changeDoc, handle]
}
