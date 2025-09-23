import type {
  DocHandle,
  DocHandleSimplifiedState,
  DocumentId,
} from "@loro-extended/repo"
import type { LoroDoc, LoroMap } from "loro-crdt"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useRepo } from "../repo-context.js"

export type DocWrapper = {
  doc: LoroMap<Record<string, unknown>>
}

/**
 * Base hook that manages DocHandle lifecycle and state synchronization.
 * This is the foundation for both simple and typed document hooks.
 *
 * Follows SRP by handling only:
 * - Handle lifecycle (creation, cleanup)
 * - Event subscription management
 * - State synchronization with React
 */
export function useDocHandleState(documentId: DocumentId) {
  const repo = useRepo()
  const [handle, setHandle] = useState<DocHandle<DocWrapper> | null>(null)

  // Handle lifecycle management
  useEffect(() => {
    repo.get<DocWrapper>(documentId).then(setHandle)
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

  return { handle, snapshot }
}

/**
 * Hook that provides raw LoroDoc access without any transformation.
 * Built on top of useDocHandleState following composition over inheritance.
 */
export function useRawLoroDoc(documentId: DocumentId) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Return raw LoroDoc when ready, null when not
  const doc =
    snapshot.state === "ready" && handle ? (handle.doc() as LoroDoc) : null

  return { doc, handle, snapshot }
}
