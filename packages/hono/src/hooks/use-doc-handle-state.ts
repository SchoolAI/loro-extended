import type { DocContent, DocHandle, DocId } from "@loro-extended/repo"
import { useCallback, useEffect, useRef, useSyncExternalStore } from "hono/jsx"
import type { LoroDoc, LoroMap } from "loro-crdt"
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
 * - We subscribe to LoroDoc changes directly via subscribe
 *
 * Follows SRP by handling only:
 * - Handle lifecycle (creation, cleanup)
 * - Event subscription management
 * - State synchronization with Hono JSX
 *
 * @param documentId - The document ID to get/create
 */
export function useDocHandleState(documentId: DocId) {
  const repo = useRepo()

  // Keep a ref to the handle so getSnapshot can access it without stale closures
  // Initialize synchronously to ensure document exists before SSE connection establishes
  const handleRef = useRef<DocHandle<DocWrapper> | null>(null)

  // Get handle synchronously during render - repo.get() is synchronous
  // This ensures the document exists in the model before the SSE connection
  // sends its initial sync-request
  if (handleRef.current === null || handleRef.current.docId !== documentId) {
    handleRef.current = repo.get<DocWrapper>(documentId)
  }
  const handle = handleRef.current

  // Event subscription management - subscribe to LoroDoc changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!handle) return () => {}
      const unsubscribe = handle.doc.subscribe(() => {
        onStoreChange()
      })

      // Check if the document version has changed since the last snapshot
      // This handles the gap between render and subscription where an event might be missed
      if (
        handle !== null &&
        snapshotRef.current !== null &&
        snapshotRef.current.version !== -1 &&
        snapshotRef.current.version !== handle.doc.opCount()
      ) {
        onStoreChange()
      }

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

  // Use a stable getSnapshot that reads from refs to avoid stale closure issues
  // Hono's useSyncExternalStore doesn't update when getSnapshot changes
  const getSnapshot = useCallback(() => {
    const currentHandle = handleRef.current
    if (currentHandle) {
      const version = currentHandle.doc.opCount()

      // Only update the ref if something actually changed
      if (snapshotRef.current && snapshotRef.current.version !== version) {
        snapshotRef.current = { version }
      }
    }

    if (!snapshotRef.current) {
      throw new Error(`snapshotRef is required`)
    }

    return snapshotRef.current
  }, []) // No dependencies - reads from refs

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
