import {
  type AsLoro,
  change,
  type DocHandle,
  ExtendedLoroDoc,
} from "@loro-extended/repo"
import { useCallback } from "react"
import type { DocWrapper } from "./use-loro-doc-state.js"

/** A function that mutates a Loro document. */
export type ChangeFn<T> = (doc: AsLoro<T>) => void

/**
 * Internal hook that provides document mutation capabilities.
 * Separated from state management for clear separation of read vs write operations.
 */
export function useLoroDocChanger<T extends object>(handle: DocHandle<DocWrapper> | null) {
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