import type { DocHandle, DocId } from "@loro-extended/repo"
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
 * With the new simplified DocHandle architecture:
 * - DocHandle is immediately available (synchronous Repo.get())
 * - Documents are always available (no loading states at DocHandle level)
 * - We subscribe to LoroDoc changes directly via subscribeLocalUpdates
 *
 * Follows SRP by handling only:
 * - Handle lifecycle (creation, cleanup)
 * - Event subscription management
 * - State synchronization with React
 */
export function useDocHandleState(documentId: DocId) {
  const repo = useRepo()
  const [handle, setHandle] = useState<DocHandle<DocWrapper> | null>(null)

  // Handle lifecycle management - now synchronous!
  useEffect(() => {
    const newHandle = repo.get<DocWrapper>(documentId)
    setHandle(newHandle)
  }, [repo, documentId])

  // Event subscription management - subscribe to LoroDoc changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!handle) return () => {}
      
      // Subscribe to all document updates (local and remote)
      const unsubscribe = handle.doc.subscribe(() => {
        onStoreChange()
      })
      
      return unsubscribe
    },
    [handle],
  )

  // State synchronization with stable snapshots
  const snapshotRef = useRef<{
    version: number
  }>({
    version: -1,
  })

  const getSnapshot = useCallback(() => {
    if (handle) {
      const version = handle.doc.opCount()

      // Only update the ref if something actually changed
      if (snapshotRef.current.version !== version) {
        snapshotRef.current = { version }
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
export function useRawLoroDoc(documentId: DocId) {
  const { handle, snapshot } = useDocHandleState(documentId)

  // Return raw LoroDoc when handle is available
  // With the new architecture, the doc is always available once we have a handle
  const doc = handle ? (handle.doc as LoroDoc) : null

  return { doc, handle, snapshot }
}
