import { type Infer, Shape } from "@loro-extended/react"

// ═══════════════════════════════════════════════════════════════════════════
// TaskState - Discriminated Union
// ═══════════════════════════════════════════════════════════════════════════
// Each state has a unique `status` discriminator and state-specific fields.
// This enables type-safe state machine transitions in the interpret function.

export const TaskStateSchema = Shape.plain.discriminatedUnion("status", {
  draft: Shape.plain.struct({
    status: Shape.plain.string("draft"),
    title: Shape.plain.string(),
    createdAt: Shape.plain.number(),
  }),
  todo: Shape.plain.struct({
    status: Shape.plain.string("todo"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    createdAt: Shape.plain.number(),
  }),
  in_progress: Shape.plain.struct({
    status: Shape.plain.string("in_progress"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    startedAt: Shape.plain.number(),
  }),
  blocked: Shape.plain.struct({
    status: Shape.plain.string("blocked"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    blockedReason: Shape.plain.string(),
    blockedAt: Shape.plain.number(),
  }),
  done: Shape.plain.struct({
    status: Shape.plain.string("done"),
    title: Shape.plain.string(),
    description: Shape.plain.string(),
    completedAt: Shape.plain.number(),
  }),
  archived: Shape.plain.struct({
    status: Shape.plain.string("archived"),
    title: Shape.plain.string(),
    archivedAt: Shape.plain.number(),
  }),
})

export type TaskState = Infer<typeof TaskStateSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Document Schema
// ═══════════════════════════════════════════════════════════════════════════

export const TaskDocSchema = Shape.doc({
  task: Shape.struct({
    state: TaskStateSchema.placeholder({
      status: "draft",
      title: "",
      createdAt: Date.now(),
    }),
  }),
})

export type TaskDoc = Infer<typeof TaskDocSchema>
