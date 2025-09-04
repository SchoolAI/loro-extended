import type { DocHandle, DocumentId } from "@loro-extended/repo"
import type { LoroDoc } from "loro-crdt"
import type { SimpleChangeFn } from "./use-doc-changer.js"
import { useSimpleDocChanger } from "./use-doc-changer.js"
import type { DocWrapper } from "./use-doc-handle-state.js"
import { useRawLoroDoc } from "./use-doc-handle-state.js"

/** The return type of the `useSimpleDocument` hook. */
export type UseSimpleDocumentReturn = [
  /** The current LoroDoc (null when not ready). */
  doc: LoroDoc | null,
  /** A function to change the document directly. */
  changeFn: (fn: SimpleChangeFn) => void,
  /** The DocHandle instance that provides access to the underlying LoroDoc and state. */
  handle: DocHandle<DocWrapper> | null,
]

/**
 * A hook that provides a reactive interface to a raw Loro document without schema dependencies.
 * This is the untyped version that works directly with LoroDoc.
 *
 * Unlike the typed version, this hook:
 * - Returns null when the document is not ready (no empty state overlay)
 * - Provides direct access to LoroDoc methods
 * - Has no schema or type validation
 * - Does not depend on @loro-extended/change
 *
 * @example
 * ```tsx
 * interface TodoDoc {
 *   title: string;
 *   todos: Array<{ id: string; text: string; completed: boolean }>;
 * }
 *
 * const [doc, changeDoc, handle] = useSimpleDocument<TodoDoc>("todo-doc");
 *
 * // Check if doc is ready before using
 * if (!doc) {
 *   return <div>Loading...</div>;
 * }
 *
 * const data = doc.toJSON() as TodoDoc;
 *
 * return (
 *   <div>
 *     {handle?.state === "loading" && <div>Syncing...</div>}
 *     
 *     <h1>{data.title}</h1>
 *     
 *     <button onClick={() => changeDoc(doc => {
 *       const titleText = doc.getText("title");
 *       titleText.insert(0, "📝 ");
 *     })}>
 *       Add Emoji
 *     </button>
 *   </div>
 * );
 * ```
 */
export function useSimpleDocument(
  documentId: DocumentId,
): UseSimpleDocumentReturn {
  const { doc, handle } = useRawLoroDoc(documentId)
  const changeDoc = useSimpleDocChanger(handle)

  return [doc, changeDoc, handle]
}