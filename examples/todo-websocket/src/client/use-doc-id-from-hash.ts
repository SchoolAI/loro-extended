import type { DocId } from "@loro-extended/repo"
import { useEffect, useState } from "react"

/**
 * A hook that manages document ID from URL hash with a fallback default.
 * @param defaultDocId The default document ID to use when hash is not set
 * @returns The current document ID based on URL hash or default
 */
export function useDocIdFromHash(defaultDocId: DocId): DocId {
  // Get document ID from URL hash if present, otherwise use default
  const [docId, setDocId] = useState<DocId>(() => {
    const hash = window.location.hash.slice(1) // Remove the '#' character
    return hash || defaultDocId
  })

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) // Remove the '#' character
      setDocId(hash || defaultDocId)
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => {
      window.removeEventListener("hashchange", handleHashChange)
    }
  }, [defaultDocId])

  return docId
}