import type { Mutable } from "@loro-extended/change"
import type { Operation } from "./operations.js"
import type { TaskDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// apply - Isolated Mutation Step
// ═══════════════════════════════════════════════════════════════════════════
// This function executes operations computed by interpret().
// All mutation is isolated here, keeping interpret pure.

export function apply(
  draft: Mutable<typeof TaskDocSchema>,
  operations: Operation[],
): void {
  for (const op of operations) {
    switch (op.type) {
      case "SET_TASK_STATE":
        draft.task.state = op.value
        break

      case "UPDATE_TITLE":
        draft.task.state.title = op.title
        break

      case "UPDATE_DESCRIPTION":
        // Only states with description field
        if (
          draft.task.state.status === "todo" ||
          draft.task.state.status === "in_progress" ||
          draft.task.state.status === "blocked"
        ) {
          draft.task.state.description = op.description
        }
        break
    }
  }
}
