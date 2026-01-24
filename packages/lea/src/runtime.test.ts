import { change, createTypedDoc, loro, Shape } from "@loro-extended/change"
import { describe, expect, it, vi } from "vitest"
import { HistoryDocSchema } from "./history.js"
import type { Reactor, Transition } from "./reactor-types.js"
import { createRuntime } from "./runtime.js"
import { createUpdate } from "./update.js"

// ═══════════════════════════════════════════════════════════════════════════
// Test Schema
// ═══════════════════════════════════════════════════════════════════════════

const TestSchema = Shape.doc({
  state: Shape.struct({
    status: Shape.plain.string(),
    count: Shape.plain.number(),
  }),
})

type TestMsg = { type: "START" } | { type: "STOP" } | { type: "INCREMENT" }

type TestTransition = Transition<typeof TestSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Test Update Function
// ═══════════════════════════════════════════════════════════════════════════

const testUpdate = createUpdate<typeof TestSchema, TestMsg>((doc, msg) => {
  switch (msg.type) {
    case "START":
      if (doc.state.status === "idle") {
        change(doc, draft => {
          draft.state.status = "running"
        })
      }
      break
    case "STOP":
      if (doc.state.status === "running") {
        change(doc, draft => {
          draft.state.status = "idle"
        })
      }
      break
    case "INCREMENT":
      change(doc, draft => {
        draft.state.count = (doc.state.count ?? 0) + 1
      })
      break
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("createRuntime", () => {
  it("dispatches messages and updates document", () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [],
    })

    dispatch({ type: "START" })
    expect(doc.state.status).toBe("running")

    dispatch({ type: "INCREMENT" })
    expect(doc.state.count).toBe(1)

    dispose()
  })

  it("invokes reactors on state transitions", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const transitions: TestTransition[] = []
    const captureReactor: Reactor<typeof TestSchema, TestMsg> = transition => {
      transitions.push(transition)
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [captureReactor],
    })

    dispatch({ type: "START" })

    // Wait for subscription to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(transitions.length).toBe(1)
    expect(transitions[0].before.state.status).toBe("idle")
    expect(transitions[0].after.state.status).toBe("running")

    dispose()
  })

  it("provides TypedDoc proxies to reactors (not plain JSON)", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const transitions: TestTransition[] = []
    const captureReactor: Reactor<typeof TestSchema, TestMsg> = transition => {
      transitions.push(transition)
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [captureReactor],
    })

    dispatch({ type: "START" })

    // Wait for subscription to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    // TypedDoc has a toJSON method
    expect(transitions.length).toBeGreaterThan(0)
    const transition = transitions[0]
    expect(typeof transition.before.toJSON).toBe("function")
    expect(typeof transition.after.toJSON).toBe("function")

    dispose()
  })

  it("allows reactors to dispatch new messages", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    // Reactor that increments count when status becomes "running"
    const autoIncrementReactor: Reactor<typeof TestSchema, TestMsg> = (
      transition,
      dispatch,
    ) => {
      if (
        transition.before.state.status !== "running" &&
        transition.after.state.status === "running"
      ) {
        dispatch({ type: "INCREMENT" })
      }
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [autoIncrementReactor],
    })

    dispatch({ type: "START" })

    // Wait for cascading dispatches
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(doc.state.status).toBe("running")
    expect(doc.state.count).toBe(1)

    dispose()
  })

  it("handles async reactors", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    let asyncReactorCalled = false
    const asyncReactor: Reactor<typeof TestSchema, TestMsg> = async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      asyncReactorCalled = true
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [asyncReactor],
    })

    dispatch({ type: "START" })

    // Wait for async reactor
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(asyncReactorCalled).toBe(true)

    dispose()
  })

  it("catches and logs reactor errors", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {})

    const errorReactor: Reactor<typeof TestSchema, TestMsg> = () => {
      throw new Error("Test error")
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [errorReactor],
    })

    dispatch({ type: "START" })

    // Wait for subscription to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    dispose()
  })

  it("stops dispatching after dispose", () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [],
    })

    dispatch({ type: "START" })
    expect(doc.state.status).toBe("running")

    dispose()

    // This should be ignored
    dispatch({ type: "STOP" })
    expect(doc.state.status).toBe("running") // Still running
  })

  it("calls done callback on dispose", () => {
    const doc = createTypedDoc(TestSchema)
    let doneCalled = false
    let doneFrontier: unknown = null

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [],
      done: frontier => {
        doneCalled = true
        doneFrontier = frontier
      },
    })

    dispatch({ type: "START" })
    dispose()

    expect(doneCalled).toBe(true)
    expect(doneFrontier).not.toBeNull()
  })

  it("appends to history document when provided", () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const historyDoc = createTypedDoc(HistoryDocSchema)

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [],
      historyDoc,
    })

    dispatch({ type: "START" })
    dispatch({ type: "INCREMENT" })

    const entries = historyDoc.toJSON().entries
    expect(entries).toHaveLength(2)
    expect(entries[0].msgType).toBe("START")
    expect(entries[1].msgType).toBe("INCREMENT")

    dispose()
  })

  it("does not invoke reactors on checkout events", async () => {
    const doc = createTypedDoc(TestSchema)
    doc.change(draft => {
      draft.state.status = "idle"
      draft.state.count = 0
    })

    const initialFrontier = loro(doc).doc.frontiers()

    const transitions: TestTransition[] = []
    const captureReactor: Reactor<typeof TestSchema, TestMsg> = transition => {
      transitions.push(transition)
    }

    const { dispatch, dispose } = createRuntime({
      doc,
      update: testUpdate,
      reactors: [captureReactor],
    })

    dispatch({ type: "START" })

    // Wait for subscription to fire
    await new Promise(resolve => setTimeout(resolve, 10))

    const transitionsBeforeCheckout = transitions.length

    // Checkout to initial state (time travel)
    loro(doc).doc.checkout(initialFrontier)

    // Wait for potential subscription
    await new Promise(resolve => setTimeout(resolve, 10))

    // No new transitions should have been recorded
    expect(transitions.length).toBe(transitionsBeforeCheckout)

    dispose()
  })
})
