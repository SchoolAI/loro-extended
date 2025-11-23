import type { DocId } from "@loro-extended/repo"
import { useEffect, useMemo, useState } from "react"
import { useDocHandleState } from "./use-doc-handle-state.js"

/**
 * A hook that provides a reactive interface to the ephemeral store (presence).
 *
 * @param docId The document ID to connect to.
 */
export function useEphemeral<T = any>(docId: DocId) {
  const { handle } = useDocHandleState(docId)
  const [peers, setPeers] = useState<Record<string, T>>({})

  useEffect(() => {
    if (!handle) return

    const update = () => {
      setPeers(handle.ephemeral.all)
    }

    update()
    return handle.ephemeral.subscribe(update)
  }, [handle])

  const self = useMemo(() => {
    if (!handle) return {} as T
    return peers[handle.peerId] || ({} as T)
  }, [peers, handle])

  const others = useMemo(() => {
    if (!handle) return {} as Record<string, T>
    const result = { ...peers }
    delete result[handle.peerId]
    return result
  }, [peers, handle])

  const setSelf = (value: Partial<T>) => {
    if (!handle) return

    Object.entries(value).forEach(([key, val]) => {
      handle.ephemeral.set(key, val)
    })
  }

  return { self, peers, others, setSelf }
}