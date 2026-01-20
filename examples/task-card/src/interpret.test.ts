import { change, createTypedDoc } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { interpret } from "./interpret.js"
import { TaskDocSchema } from "./schema.js"

// Helper to create a fresh document with initial state
function createDoc() {
  return createTypedDoc(TaskDocSchema)
}

describe("interpret", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE_TITLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UPDATE_TITLE", () => {
    it("updates title in draft state", () => {
      const doc = createDoc()
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("New Title")
    })

    it("updates title in todo state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Old Title",
          description: "",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("New Title")
    })

    it("updates title in in_progress state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Old Title",
          description: "",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("New Title")
    })

    it("updates title in blocked state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "blocked",
          title: "Old Title",
          description: "",
          blockedReason: "Waiting",
          blockedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("New Title")
    })

    it("does NOT update title in done state (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "done",
          title: "Old Title",
          description: "",
          completedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("Old Title")
    })

    it("does NOT update title in archived state (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "archived",
          title: "Old Title",
          archivedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_TITLE", title: "New Title" })
      })
      expect(doc.task.state.title).toBe("Old Title")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE_DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UPDATE_DESCRIPTION", () => {
    it("updates description in todo state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Task",
          description: "Old",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_DESCRIPTION", description: "New" })
      })
      const state = doc.task.state
      if (state.status === "todo") {
        expect(state.description).toBe("New")
      }
    })

    it("updates description in in_progress state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Task",
          description: "Old",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_DESCRIPTION", description: "New" })
      })
      const state = doc.task.state
      if (state.status === "in_progress") {
        expect(state.description).toBe("New")
      }
    })

    it("updates description in blocked state", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "blocked",
          title: "Task",
          description: "Old",
          blockedReason: "Waiting",
          blockedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_DESCRIPTION", description: "New" })
      })
      const state = doc.task.state
      if (state.status === "blocked") {
        expect(state.description).toBe("New")
      }
    })

    it("does NOT update description in draft state (no description field)", () => {
      const doc = createDoc()
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_DESCRIPTION", description: "New" })
      })
      // Draft state doesn't have description field
      expect(doc.task.state.status).toBe("draft")
    })

    it("does NOT update description in done state (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "done",
          title: "Task",
          description: "Old",
          completedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UPDATE_DESCRIPTION", description: "New" })
      })
      const state = doc.task.state
      if (state.status === "done") {
        expect(state.description).toBe("Old")
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISH (draft → todo)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PUBLISH", () => {
    it("transitions from draft to todo", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "draft",
          title: "My Task",
          createdAt: 1000,
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "PUBLISH" })
      })
      expect(doc.task.state.status).toBe("todo")
      expect(doc.task.state.title).toBe("My Task")
      const state = doc.task.state
      if (state.status === "todo") {
        expect(state.description).toBe("")
        expect(state.createdAt).toBe(1000)
      }
    })

    it("does NOT transition from todo (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Task",
          description: "",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "PUBLISH" })
      })
      expect(doc.task.state.status).toBe("todo")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // START (todo → in_progress)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("START", () => {
    it("transitions from todo to in_progress", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "My Task",
          description: "Details",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "START" })
      })
      expect(doc.task.state.status).toBe("in_progress")
      expect(doc.task.state.title).toBe("My Task")
      const state = doc.task.state
      if (state.status === "in_progress") {
        expect(state.description).toBe("Details")
        expect(state.startedAt).toBeGreaterThan(0)
      }
    })

    it("does NOT transition from draft (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        interpret(draft, { type: "START" })
      })
      expect(doc.task.state.status).toBe("draft")
    })

    it("does NOT transition from in_progress (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Task",
          description: "",
          startedAt: 1000,
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "START" })
      })
      expect(doc.task.state.status).toBe("in_progress")
      const state = doc.task.state
      if (state.status === "in_progress") {
        expect(state.startedAt).toBe(1000) // unchanged
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOCK (in_progress → blocked)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("BLOCK", () => {
    it("transitions from in_progress to blocked with reason", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "My Task",
          description: "Details",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "BLOCK", reason: "Waiting for API" })
      })
      expect(doc.task.state.status).toBe("blocked")
      const state = doc.task.state
      if (state.status === "blocked") {
        expect(state.blockedReason).toBe("Waiting for API")
        expect(state.blockedAt).toBeGreaterThan(0)
      }
    })

    it("does NOT transition from todo (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Task",
          description: "",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "BLOCK", reason: "Test" })
      })
      expect(doc.task.state.status).toBe("todo")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // UNBLOCK (blocked → in_progress)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("UNBLOCK", () => {
    it("transitions from blocked to in_progress", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "blocked",
          title: "My Task",
          description: "Details",
          blockedReason: "Waiting",
          blockedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UNBLOCK" })
      })
      expect(doc.task.state.status).toBe("in_progress")
      const state = doc.task.state
      if (state.status === "in_progress") {
        expect(state.startedAt).toBeGreaterThan(0)
      }
    })

    it("does NOT transition from in_progress (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Task",
          description: "",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "UNBLOCK" })
      })
      expect(doc.task.state.status).toBe("in_progress")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE (in_progress → done)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("COMPLETE", () => {
    it("transitions from in_progress to done", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "My Task",
          description: "Details",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "COMPLETE" })
      })
      expect(doc.task.state.status).toBe("done")
      const state = doc.task.state
      if (state.status === "done") {
        expect(state.completedAt).toBeGreaterThan(0)
      }
    })

    it("does NOT transition from todo (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Task",
          description: "",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "COMPLETE" })
      })
      expect(doc.task.state.status).toBe("todo")
    })

    it("does NOT transition from blocked (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "blocked",
          title: "Task",
          description: "",
          blockedReason: "Waiting",
          blockedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "COMPLETE" })
      })
      expect(doc.task.state.status).toBe("blocked")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // REOPEN (done → todo)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("REOPEN", () => {
    it("transitions from done to todo", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "done",
          title: "My Task",
          description: "Details",
          completedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "REOPEN" })
      })
      expect(doc.task.state.status).toBe("todo")
      const state = doc.task.state
      if (state.status === "todo") {
        expect(state.title).toBe("My Task")
        expect(state.description).toBe("Details")
      }
    })

    it("does NOT transition from in_progress (guard)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Task",
          description: "",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "REOPEN" })
      })
      expect(doc.task.state.status).toBe("in_progress")
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHIVE (any → archived)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("ARCHIVE", () => {
    it("transitions from draft to archived", () => {
      const doc = createDoc()
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
    })

    it("transitions from todo to archived", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Task",
          description: "",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
    })

    it("transitions from in_progress to archived", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "in_progress",
          title: "Task",
          description: "",
          startedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
    })

    it("transitions from blocked to archived", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "blocked",
          title: "Task",
          description: "",
          blockedReason: "Waiting",
          blockedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
    })

    it("transitions from done to archived", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "done",
          title: "Task",
          description: "",
          completedAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
    })

    it("does NOT transition from archived (guard - already archived)", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "archived",
          title: "Task",
          archivedAt: 1000,
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.status).toBe("archived")
      const state = doc.task.state
      if (state.status === "archived") {
        expect(state.archivedAt).toBe(1000) // unchanged
      }
    })

    it("preserves title when archiving", () => {
      const doc = createDoc()
      change(doc, draft => {
        draft.task.state = {
          status: "todo",
          title: "Important Task",
          description: "Details",
          createdAt: Date.now(),
        }
      })
      change(doc, draft => {
        interpret(draft, { type: "ARCHIVE" })
      })
      expect(doc.task.state.title).toBe("Important Task")
    })
  })
})
