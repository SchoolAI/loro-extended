import {
  type AsLoro,
  change,
  type DocHandle,
  type DocumentId,
  ExtendedLoroDoc,
} from "@loro-extended/repo"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { useRepo } from "../contexts/RepoContext"

export type LoroDocState = "loading" | "ready" | "unavailable"

/** A function that mutates a Loro document. */
export type ChangeFn<T> = (doc: AsLoro<T>) => void

/** The return type of the `useLoroDoc` hook. */
export type UseLoroDocReturn<T> = [
  /** The current state of the document, or undefined if not ready. */
  doc: T | undefined,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The current state of the DocHandle. */
  state: LoroDocState,
]

/**
 * A hook that provides a reactive interface to a Loro document handle.
 *
 * It returns a tuple containing the document's data, a function to
 * modify it, and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const [doc, changeDoc, state] = useLoroDoc(handle)
 *
 * if (state !== 'ready') {
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
export function useLoroDoc<T extends Record<string, any>>(
  documentId: DocumentId,
): UseLoroDocReturn<T> {
  const repo = useRepo()
  const [handle, setHandle] = useState<DocHandle<T> | null>(null)
  useEffect(() => {
    repo.findOrCreate<T>(documentId).then(setHandle)
  }, [repo, documentId])

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

  const getSnapshot = useMemo(() => {
    let lastSnapshot: { version: string | null; state: LoroDocState } | null =
      null

    return () => {
      const currentState = handle?.state ?? "loading"
      const simpleState: LoroDocState =
        currentState === "ready" ? "ready" : "loading"
      if (!currentState) {
        return { version: null, state: "loading" as const }
      }
      let currentVersion: string | null = null
      if (simpleState === "ready" && handle) {
        const vv = handle.doc()?.oplogVersion()
        if (vv) {
          currentVersion = JSON.stringify(Object.fromEntries(vv.toJSON()))
        }
      }

      if (
        lastSnapshot &&
        lastSnapshot.state === simpleState &&
        lastSnapshot.version === currentVersion
      ) {
        return lastSnapshot
      }

      lastSnapshot = { version: currentVersion, state: simpleState }
      return lastSnapshot
    }
  }, [handle])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const doc = useMemo(() => {
    if (snapshot.state !== "ready" || snapshot.version === null) {
      return undefined
    }

    const loroDoc = handle?.doc()

    if (!loroDoc) return undefined

    // Wrap and return the plain JSON representation
    const extendedDoc = ExtendedLoroDoc.wrap<T>(loroDoc)
    return extendedDoc.toJSON()
  }, [snapshot, handle])

  const changeDoc = useCallback(
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

  return [doc as T | undefined, changeDoc, snapshot.state]
}
