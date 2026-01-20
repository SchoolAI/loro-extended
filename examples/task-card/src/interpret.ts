import type { Mutable } from "@loro-extended/change"
import type { TaskIntention } from "./intentions.ts"
import type { TaskDocSchema } from "./schema.ts"

// ═══════════════════════════════════════════════════════════════════════════
// interpret - Impure Function that Applies Intentions to CRDT State
// ═══════════════════════════════════════════════════════════════════════════
// This function is the heart of the LEA pattern. It:
// 1. Receives a mutable draft of the CRDT document
// 2. Checks guard conditions based on current state
// 3. Applies the intention by mutating the draft
// 4. Invalid transitions are silently ignored (no-ops)

export function interpret(
  draft: Mutable<typeof TaskDocSchema>,
  intention: TaskIntention,
): void {
  const state = draft.task.state

  switch (intention.type) {
    // ═══════════════════════════════════════════════════════════════════════
    // Content Updates
    // ═══════════════════════════════════════════════════════════════════════

    case "UPDATE_TITLE": {
      // Can update title in draft, todo, in_progress, blocked
      // Cannot update in done or archived
      if (state.status === "done" || state.status === "archived") return
      state.title = intention.title
      break
    }

    case "UPDATE_DESCRIPTION": {
      // Can only update description in states that have it
      // draft and archived don't have description
      if (
        state.status === "draft" ||
        state.status === "done" ||
        state.status === "archived"
      )
        return
      state.description = intention.description
      break
    }

    // ═══════════════════════════════════════════════════════════════════════
    // State Transitions
    // ═══════════════════════════════════════════════════════════════════════

    case "PUBLISH": {
      // draft → todo
      if (state.status !== "draft") return
      draft.task.state = {
        status: "todo",
        title: state.title,
        description: "",
        createdAt: state.createdAt,
      }
      break
    }

    case "START": {
      // todo → in_progress
      if (state.status !== "todo") return
      draft.task.state = {
        status: "in_progress",
        title: state.title,
        description: state.description,
        startedAt: Date.now(),
      }
      break
    }

    case "BLOCK": {
      // in_progress → blocked
      if (state.status !== "in_progress") return
      draft.task.state = {
        status: "blocked",
        title: state.title,
        description: state.description,
        blockedReason: intention.reason,
        blockedAt: Date.now(),
      }
      break
    }

    case "UNBLOCK": {
      // blocked → in_progress
      if (state.status !== "blocked") return
      draft.task.state = {
        status: "in_progress",
        title: state.title,
        description: state.description,
        startedAt: Date.now(),
      }
      break
    }

    case "COMPLETE": {
      // in_progress → done
      if (state.status !== "in_progress") return
      draft.task.state = {
        status: "done",
        title: state.title,
        description: state.description,
        completedAt: Date.now(),
      }
      break
    }

    case "REOPEN": {
      // done → todo
      if (state.status !== "done") return
      draft.task.state = {
        status: "todo",
        title: state.title,
        description: state.description,
        createdAt: Date.now(),
      }
      break
    }

    case "ARCHIVE": {
      // any (except archived) → archived
      if (state.status === "archived") return
      draft.task.state = {
        status: "archived",
        title: state.title,
        archivedAt: Date.now(),
      }
      break
    }
  }
}
