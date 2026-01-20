import { loro } from "@loro-extended/change"
import type { Handle } from "@loro-extended/react"
import { useDoc } from "@loro-extended/react"
import { useCallback } from "react"
import { apply } from "./apply.js"
import type { TaskIntention } from "./intentions.js"
import { interpret } from "./interpret.js"
import type { TaskDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// useTask - React Hook for Task State Machine (Full LEA)
// ═══════════════════════════════════════════════════════════════════════════
// This hook implements the full LEA dispatch pattern:
// 1. Capture current frontier (the causal context)
// 2. Call pure interpret(doc, intention, frontier) to compute operations
// 3. Call apply() to execute operations (isolated mutation)
//
// The dispatch function captures the frontier at dispatch time, which
// provides both the state context AND the logical timestamp.

export function useTask(handle: Handle<typeof TaskDocSchema>) {
  // Use useDoc with a selector to get just the task state
  const task = useDoc(handle, doc => doc.task.state)

  const dispatch = useCallback(
    (intention: TaskIntention) => {
      // Capture frontier at dispatch time (the "anchored" context)
      // This gives us both state and logical timestamp
      const frontier = loro(handle.doc).doc.frontiers()

      // Pure interpretation: compute operations from (doc, intention, frontier)
      const operations = interpret(handle.doc, intention, frontier)

      // Isolated mutation: apply operations
      if (operations.length > 0) {
        handle.change(draft => {
          apply(draft, operations)
        })
      }
    },
    [handle],
  )

  return { task, dispatch }
}
