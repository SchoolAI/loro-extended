import type { Handle } from "@loro-extended/react"
import { useDoc } from "@loro-extended/react"
import { useCallback } from "react"
import type { TaskIntention } from "./intentions.js"
import { interpret } from "./interpret.js"
import type { TaskDocSchema, TaskState } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// useTask - React Hook for Task State Machine
// ═══════════════════════════════════════════════════════════════════════════
// This hook provides:
// 1. The current task state (reactive via useDoc with selector)
// 2. A dispatch function to send intentions
//
// The dispatch function wraps handle.change() with intention interpretation,
// ensuring all state transitions go through the interpret function.

export function useTask(handle: Handle<typeof TaskDocSchema>) {
  // Use useDoc with a selector to get just the task state
  const task = useDoc(handle, doc => doc.task.state) as TaskState

  const dispatch = useCallback(
    (intention: TaskIntention) => {
      handle.change(draft => {
        interpret(draft, intention)
      })
    },
    [handle],
  )

  return { task, dispatch }
}
