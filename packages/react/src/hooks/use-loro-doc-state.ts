import {
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
import { useRepo } from "../repo-context.js"

export type DocWrapper = {
  doc: LoroMap<Record<string, unknown>>
}

/**
 * Internal hook that manages Loro document state, including handle lifecycle,
 * event subscriptions, and reactive state synchronization.
 */
export function useLoroDocState<T extends object>(documentId: DocumentId) {
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
