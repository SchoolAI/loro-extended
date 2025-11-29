import type { DocId } from "@loro-extended/repo"
import { useEffect, useState } from "react"

/**
 * A hook that manages room ID from URL hash with a fallback default.
 * @param defaultRoomId The default room ID to use when hash is not set
 * @returns The current room ID based on URL hash or default
 */
export function useRoomIdFromHash(defaultRoomId: DocId): DocId {
  // Get room ID from URL hash if present, otherwise use default
  const [roomId, setRoomId] = useState<DocId>(() => {
    const hash = window.location.hash.slice(1) // Remove the '#' character
    return hash || defaultRoomId
  })

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) // Remove the '#' character
      setRoomId(hash || defaultRoomId)
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => {
      window.removeEventListener("hashchange", handleHashChange)
    }
  }, [defaultRoomId])

  return roomId
}