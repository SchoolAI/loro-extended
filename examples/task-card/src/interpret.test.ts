import {
  change,
  createTypedDoc,
  type Frontiers,
  loro,
} from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import {
  getStateAtFrontier,
  getTimestampFromFrontier,
  interpret,
} from "./interpret.js"
import { TaskDocSchema, type TaskState } from "./schema.js"

// Helper to create a doc with a specific state and return (doc, frontier)
function createDocWithState(state: TaskState) {
  const doc = createTypedDoc(TaskDocSchema)
  change(doc, draft => {
    draft.task.state = state
  })
  const frontier = loro(doc).doc.frontiers()
  return { doc, frontier }
}

// Helper states
function draftState(title = ""): TaskState {
  return { status: "draft", title, createdAt: 1000 }
}

function todoState(title = "Task", description = ""): TaskState {
  return { status: "todo", title, description, createdAt: 1000 }
}

function inProgressState(title = "Task", description = ""): TaskState {
  return { status: "in_progress", title, description, startedAt: 2000 }
}

function blockedState(
  title = "Task",
  description = "",
  reason = "Waiting",
): TaskState {
  return {
    status: "blocked",
    title,
    description,
    blockedReason: reason,
    blockedAt: 3000,
  }
}

function doneState(title = "Task", description = ""): TaskState {
  return { status: "done", title, description, completedAt: 4000 }
}

function archivedState(title = "Task"): TaskState {
  return { status: "archived", title, archivedAt: 5000 }
}

describe("interpret (full LEA with frontiers)", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Helper function tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getStateAtFrontier", () => {
    it("returns state at the given frontier", () => {
      const { doc, frontier } = createDocWithState(draftState("Hello"))
      const state = getStateAtFrontier(doc, frontier)
      expect(state.status).toBe("draft")
      expect(state.title).toBe("Hello")
    })

    it("returns historical state when frontier is from the past", () => {
      const doc = createTypedDoc(TaskDocSchema)
      change(doc, draft => {
        draft.task.state = draftState("First")
      })
      const oldFrontier = loro(doc).doc.frontiers()

      change(doc, draft => {
        draft.task.state = todoState("Second", "Description")
      })

      // Current state is "Second"
      expect(doc.task.state.title).toBe("Second")

      // But state at old frontier is "First"
      const oldState = getStateAtFrontier(doc, oldFrontier)
      expect(oldState.title).toBe("First")
      expect(oldState.status).toBe("draft")
    })
  })

  describe("getTimestampFromFrontier", () => {
    it("returns 0 for empty frontier", () => {
      const emptyFrontier: Frontiers = []
      expect(getTimestampFromFrontier(emptyFrontier)).toBe(0)
    })

    it("increases monotonically as operations are added", () => {
      const doc = createTypedDoc(TaskDocSchema)
      const t0 = getTimestampFromFrontier(loro(doc).doc.frontiers())

      change(doc, draft => {
        draft.task.state = draftState("First")
      })
      const t1 = getTimestampFromFrontier(loro(doc).doc.frontiers())

      change(doc, draft => {
        draft.task.state = todoState("Second")
      })
      const t2 = getTimestampFromFrontier(loro(doc).doc.frontiers())

      expect(t1).toBeGreaterThan(t0)
      expect(t2).toBeGreaterThan(t1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE_TITLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UPDATE_TITLE", () => {
    it("returns UPDATE_TITLE operation in draft state", () => {
      const { doc, frontier } = createDocWithState(draftState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_TITLE", title: "New Title" }])
    })

    it("returns UPDATE_TITLE operation in todo state", () => {
      const { doc, frontier } = createDocWithState(todoState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_TITLE", title: "New Title" }])
    })

    it("returns UPDATE_TITLE operation in in_progress state", () => {
      const { doc, frontier } = createDocWithState(inProgressState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_TITLE", title: "New Title" }])
    })

    it("returns UPDATE_TITLE operation in blocked state", () => {
      const { doc, frontier } = createDocWithState(blockedState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_TITLE", title: "New Title" }])
    })

    it("returns empty operations in done state (guard)", () => {
      const { doc, frontier } = createDocWithState(doneState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([])
    })

    it("returns empty operations in archived state (guard)", () => {
      const { doc, frontier } = createDocWithState(archivedState())
      const ops = interpret(
        doc,
        { type: "UPDATE_TITLE", title: "New Title" },
        frontier,
      )
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE_DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UPDATE_DESCRIPTION", () => {
    it("returns UPDATE_DESCRIPTION operation in todo state", () => {
      const { doc, frontier } = createDocWithState(todoState())
      const ops = interpret(
        doc,
        { type: "UPDATE_DESCRIPTION", description: "New" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_DESCRIPTION", description: "New" }])
    })

    it("returns UPDATE_DESCRIPTION operation in in_progress state", () => {
      const { doc, frontier } = createDocWithState(inProgressState())
      const ops = interpret(
        doc,
        { type: "UPDATE_DESCRIPTION", description: "New" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_DESCRIPTION", description: "New" }])
    })

    it("returns UPDATE_DESCRIPTION operation in blocked state", () => {
      const { doc, frontier } = createDocWithState(blockedState())
      const ops = interpret(
        doc,
        { type: "UPDATE_DESCRIPTION", description: "New" },
        frontier,
      )
      expect(ops).toEqual([{ type: "UPDATE_DESCRIPTION", description: "New" }])
    })

    it("returns empty operations in draft state (no description field)", () => {
      const { doc, frontier } = createDocWithState(draftState())
      const ops = interpret(
        doc,
        { type: "UPDATE_DESCRIPTION", description: "New" },
        frontier,
      )
      expect(ops).toEqual([])
    })

    it("returns empty operations in done state (guard)", () => {
      const { doc, frontier } = createDocWithState(doneState())
      const ops = interpret(
        doc,
        { type: "UPDATE_DESCRIPTION", description: "New" },
        frontier,
      )
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISH (draft → todo)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PUBLISH", () => {
    it("returns SET_TASK_STATE operation from draft to todo", () => {
      const { doc, frontier } = createDocWithState(draftState("My Task"))
      const ops = interpret(doc, { type: "PUBLISH" }, frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "todo",
            title: "My Task",
            description: "",
            createdAt: 1000,
          },
        },
      ])
    })

    it("returns empty operations from todo (guard)", () => {
      const { doc, frontier } = createDocWithState(todoState())
      const ops = interpret(doc, { type: "PUBLISH" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // START (todo → in_progress)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("START", () => {
    it("returns SET_TASK_STATE operation from todo to in_progress", () => {
      const { doc, frontier } = createDocWithState(
        todoState("My Task", "Details"),
      )
      const ops = interpret(doc, { type: "START" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "in_progress",
            title: "My Task",
            description: "Details",
            startedAt: timestamp, // Derived from frontier!
          },
        },
      ])
    })

    it("returns empty operations from draft (guard)", () => {
      const { doc, frontier } = createDocWithState(draftState())
      const ops = interpret(doc, { type: "START" }, frontier)
      expect(ops).toEqual([])
    })

    it("returns empty operations from in_progress (guard)", () => {
      const { doc, frontier } = createDocWithState(inProgressState())
      const ops = interpret(doc, { type: "START" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOCK (in_progress → blocked)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("BLOCK", () => {
    it("returns SET_TASK_STATE operation from in_progress to blocked", () => {
      const { doc, frontier } = createDocWithState(
        inProgressState("My Task", "Details"),
      )
      const ops = interpret(
        doc,
        { type: "BLOCK", reason: "Waiting for API" },
        frontier,
      )
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "blocked",
            title: "My Task",
            description: "Details",
            blockedReason: "Waiting for API",
            blockedAt: timestamp,
          },
        },
      ])
    })

    it("returns empty operations from todo (guard)", () => {
      const { doc, frontier } = createDocWithState(todoState())
      const ops = interpret(doc, { type: "BLOCK", reason: "Test" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UNBLOCK (blocked → in_progress)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UNBLOCK", () => {
    it("returns SET_TASK_STATE operation from blocked to in_progress", () => {
      const { doc, frontier } = createDocWithState(
        blockedState("My Task", "Details"),
      )
      const ops = interpret(doc, { type: "UNBLOCK" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "in_progress",
            title: "My Task",
            description: "Details",
            startedAt: timestamp,
          },
        },
      ])
    })

    it("returns empty operations from in_progress (guard)", () => {
      const { doc, frontier } = createDocWithState(inProgressState())
      const ops = interpret(doc, { type: "UNBLOCK" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE (in_progress → done)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("COMPLETE", () => {
    it("returns SET_TASK_STATE operation from in_progress to done", () => {
      const { doc, frontier } = createDocWithState(
        inProgressState("My Task", "Details"),
      )
      const ops = interpret(doc, { type: "COMPLETE" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "done",
            title: "My Task",
            description: "Details",
            completedAt: timestamp,
          },
        },
      ])
    })

    it("returns empty operations from todo (guard)", () => {
      const { doc, frontier } = createDocWithState(todoState())
      const ops = interpret(doc, { type: "COMPLETE" }, frontier)
      expect(ops).toEqual([])
    })

    it("returns empty operations from blocked (guard)", () => {
      const { doc, frontier } = createDocWithState(blockedState())
      const ops = interpret(doc, { type: "COMPLETE" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // REOPEN (done → todo)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("REOPEN", () => {
    it("returns SET_TASK_STATE operation from done to todo", () => {
      const { doc, frontier } = createDocWithState(
        doneState("My Task", "Details"),
      )
      const ops = interpret(doc, { type: "REOPEN" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "todo",
            title: "My Task",
            description: "Details",
            createdAt: timestamp,
          },
        },
      ])
    })

    it("returns empty operations from in_progress (guard)", () => {
      const { doc, frontier } = createDocWithState(inProgressState())
      const ops = interpret(doc, { type: "REOPEN" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHIVE (any → archived)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("ARCHIVE", () => {
    it("returns SET_TASK_STATE operation from draft to archived", () => {
      const { doc, frontier } = createDocWithState(draftState("Task"))
      const ops = interpret(doc, { type: "ARCHIVE" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "archived",
            title: "Task",
            archivedAt: timestamp,
          },
        },
      ])
    })

    it("returns SET_TASK_STATE operation from todo to archived", () => {
      const { doc, frontier } = createDocWithState(todoState("Task"))
      const ops = interpret(doc, { type: "ARCHIVE" }, frontier)
      const timestamp = getTimestampFromFrontier(frontier)
      expect(ops).toEqual([
        {
          type: "SET_TASK_STATE",
          value: {
            status: "archived",
            title: "Task",
            archivedAt: timestamp,
          },
        },
      ])
    })

    it("returns empty operations from archived (guard - already archived)", () => {
      const { doc, frontier } = createDocWithState(archivedState("Task"))
      const ops = interpret(doc, { type: "ARCHIVE" }, frontier)
      expect(ops).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Purity Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("purity", () => {
    it("is deterministic - same inputs produce same outputs", () => {
      const { doc, frontier } = createDocWithState(
        todoState("Task", "Description"),
      )
      const intention = { type: "START" as const }

      const ops1 = interpret(doc, intention, frontier)
      const ops2 = interpret(doc, intention, frontier)

      expect(ops1).toEqual(ops2)
    })

    it("derives timestamp from frontier, not Date.now()", () => {
      const { doc, frontier } = createDocWithState(
        todoState("Task", "Description"),
      )
      const intention = { type: "START" as const }

      // Call interpret multiple times - should always get same timestamp
      const ops1 = interpret(doc, intention, frontier)
      const ops2 = interpret(doc, intention, frontier)

      expect(ops1[0]).toHaveProperty("value.startedAt")
      expect(ops2[0]).toHaveProperty("value.startedAt")
      expect((ops1[0] as any).value.startedAt).toBe(
        (ops2[0] as any).value.startedAt,
      )
    })

    it("uses historical state when given old frontier", () => {
      const doc = createTypedDoc(TaskDocSchema)
      change(doc, draft => {
        draft.task.state = todoState("First", "Description")
      })
      const oldFrontier = loro(doc).doc.frontiers()

      // Advance state
      change(doc, draft => {
        draft.task.state = doneState("Second", "Done")
      })

      // Interpret with old frontier should use old state
      const ops = interpret(doc, { type: "START" }, oldFrontier)

      // Should succeed because at oldFrontier, state was "todo"
      expect(ops.length).toBe(1)
      expect(ops[0].type).toBe("SET_TASK_STATE")
      expect((ops[0] as any).value.status).toBe("in_progress")
      expect((ops[0] as any).value.title).toBe("First")
    })
  })
})
