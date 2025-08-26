import {
  type AsLoro,
  change,
  type DocHandle,
  type DocHandleSimplifiedState,
  type DocumentId,
  ExtendedLoroDoc,
} from "@loro-extended/repo"
import type { LoroMap } from "loro-crdt"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useRepo } from "./repo-context.js"

export type DocWrapper = {
  doc: LoroMap<Record<string, unknown>>
}

/** A function that mutates a Loro document. */
export type ChangeFn<T> = (doc: AsLoro<T>) => void

/** The return type of the `useLoroDoc` hook. */
export type UseLoroDocReturn<T extends object> = [
  /** The current state of the document, or undefined if not ready. */
  doc: T | undefined,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The DocHandle instance that provides access to the underlying LoroDoc and state. */
  handle: DocHandle<DocWrapper> | null,
]

/**
 * Internal hook that manages Loro document state, including handle lifecycle,
 * event subscriptions, and reactive state synchronization.
 */
function useLoroDocState<T extends object>(documentId: DocumentId) {
  const repo = useRepo()
  const [handle, setHandle] = useState<DocHandle<DocWrapper> | null>(null)
  
  // Handle lifecycle management
  useEffect(() => {
    repo.findOrCreate<DocWrapper>(documentId).then(setHandle)
  }, [repo, documentId])

  // Event subscription management
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!handle) return () => {}
      handle.on("doc-handle-change", onStoreChange)
      handle.on("doc-handle-state-transition", onStoreChange)
      return () => {
        handle.off("doc-handle-change", onStoreChange)
        handle.off("doc-handle-state-transition", onStoreChange)
      }
    },
    [handle],
  )

  // State synchronization with stable snapshots
  const snapshotRef = useRef<{
    version: number
    state: DocHandleSimplifiedState
  }>({
    version: -1,
    state: "loading",
  })

  const getSnapshot = useCallback(() => {
    if (handle) {
      const state = handle.state
      const version = handle.doc()?.opCount() ?? -1

      // Only update the ref if something actually changed
      if (
        snapshotRef.current.state !== state ||
        snapshotRef.current.version !== version
      ) {
        snapshotRef.current = { version, state }
      }
    }

    return snapshotRef.current
  }, [handle])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  // Data transformation from Loro to JSON
  const doc = useMemo(() => {
    if (snapshot.state !== "ready" || snapshot.version === -1) {
      return undefined
    }

    const loroDoc = handle?.doc()
    if (!loroDoc) return undefined

    // Wrap and return the plain JSON representation
    const extendedDoc = ExtendedLoroDoc.wrap<T>(loroDoc)
    return extendedDoc.toJSON()
  }, [snapshot, handle])

  return { doc: doc as T | undefined, handle, snapshot }
}

/**
 * Internal hook that provides document mutation capabilities.
 * Separated from state management for clear separation of read vs write operations.
 */
function useLoroDocChanger<T extends object>(handle: DocHandle<DocWrapper> | null) {
  return useCallback(
    (fn: ChangeFn<T>) => {
      if (!handle) {
        console.warn("doc handle not available for change")
        return
      }
      handle.change(loroDoc => {
        // Use the change function from @loro-extended/repo to handle the conversion
        const extendedDoc = ExtendedLoroDoc.wrap<AsLoro<T>>(loroDoc)
        change(extendedDoc, fn)
      })
    },
    [handle],
  )
}

/**
 * A hook that provides a reactive interface to a Loro document handle.
 *
 * It returns a tuple containing the document's data, a function to
 * modify it, and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const [doc, changeDoc, handle] = useLoroDoc(documentId)
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
export function useLoroDoc<T extends object>(
  documentId: DocumentId,
): UseLoroDocReturn<T> {
  const { doc, handle } = useLoroDocState<T>(documentId)
  const changeDoc = useLoroDocChanger<T>(handle)
  
  return [doc, changeDoc, handle]
}
