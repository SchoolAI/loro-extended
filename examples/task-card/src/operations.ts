import type { TaskState } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// Operations - Pure Data Describing State Mutations
// ═══════════════════════════════════════════════════════════════════════════
// Operations are the output of interpret(). They describe what mutations
// to perform, but don't perform them. This separation keeps interpret pure.

export type Operation =
  | { type: "SET_TASK_STATE"; value: TaskState }
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "UPDATE_DESCRIPTION"; description: string }
