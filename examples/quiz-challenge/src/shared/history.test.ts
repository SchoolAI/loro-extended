import { createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { getMessageHistory } from "./history.js"
import { runtime } from "./runtime.js"
import { DEFAULT_QUESTIONS, QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// History Utility Tests
// ═══════════════════════════════════════════════════════════════════════════
//
// These tests verify the history retrieval functionality:
// 1. Commit messages are stored correctly by dispatch
// 2. getMessageHistory retrieves messages in chronological order
// 3. Malformed or missing messages are handled gracefully

describe("getMessageHistory", () => {
  function createDoc() {
    return createTypedDoc(QuizDocSchema)
  }

  it("returns empty array for doc with no commits", () => {
    const doc = createDoc()
    const history = getMessageHistory(doc)
    expect(history).toEqual([])
  })

  it("returns messages in chronological order", () => {
    const doc = createDoc()

    const { dispatch, dispose } = runtime({
      doc,
      questions: DEFAULT_QUESTIONS,
      reactors: [],
    })

    // Dispatch several messages
    dispatch({ type: "START_QUIZ", timestamp: Date.now() })
    dispatch({ type: "SELECT_OPTION", optionIndex: 1 })
    dispatch({ type: "SUBMIT_ANSWER" })

    dispose()

    const history = getMessageHistory(doc)

    // Should have 3 entries in chronological order
    expect(history.length).toBe(3)
    expect(history[0].msg.type).toBe("START_QUIZ")
    expect(history[1].msg.type).toBe("SELECT_OPTION")
    expect(history[2].msg.type).toBe("SUBMIT_ANSWER")
  })

  it("includes timestamp and frontier in each entry", () => {
    const doc = createDoc()

    const { dispatch, dispose } = runtime({
      doc,
      questions: DEFAULT_QUESTIONS,
      reactors: [],
    })

    const beforeDispatch = Date.now()
    dispatch({ type: "START_QUIZ", timestamp: Date.now() })
    const afterDispatch = Date.now()

    dispose()

    const history = getMessageHistory(doc)

    expect(history.length).toBe(1)
    const entry = history[0]

    // Timestamp should be within the dispatch window
    expect(entry.timestamp).toBeGreaterThanOrEqual(beforeDispatch)
    expect(entry.timestamp).toBeLessThanOrEqual(afterDispatch)

    // Frontier should be defined for entries from getMessageHistory
    expect(entry.frontier).toBeDefined()
    if (entry.frontier) {
      expect(entry.frontier.length).toBeGreaterThan(0)
    }

    // ID should be in the format counter@peer
    expect(entry.id).toMatch(/^\d+@\d+$/)
  })

  it("skips changes without commit messages", () => {
    const doc = createDoc()

    // Make a change directly without using dispatch (no commit message)
    doc.change(draft => {
      draft.quiz.state = {
        status: "answering",
        questionIndex: 0,
        selectedOption: null,
        startedAt: Date.now(),
      }
    })

    const history = getMessageHistory(doc)

    // Should be empty since no commit message was set
    expect(history).toEqual([])
  })

  it("handles malformed commit messages gracefully", () => {
    const doc = createDoc()

    // Set an invalid commit message
    loro(doc).doc.setNextCommitMessage("not valid json")
    doc.change(draft => {
      draft.quiz.state = {
        status: "answering",
        questionIndex: 0,
        selectedOption: null,
        startedAt: Date.now(),
      }
    })

    // Set a valid commit message
    loro(doc).doc.setNextCommitMessage(
      JSON.stringify({
        type: "START_QUIZ",
        msg: { type: "START_QUIZ", timestamp: Date.now() },
        timestamp: Date.now(),
      }),
    )
    doc.change(draft => {
      if (draft.quiz.state.status === "answering") {
        draft.quiz.state.selectedOption = 0
      }
    })

    const history = getMessageHistory(doc)

    // Should only have the valid entry
    expect(history.length).toBe(1)
    expect(history[0].msg.type).toBe("START_QUIZ")
  })

  it("preserves full message data in entries", () => {
    const doc = createDoc()

    const { dispatch, dispose } = runtime({
      doc,
      questions: DEFAULT_QUESTIONS,
      reactors: [],
    })

    dispatch({ type: "START_QUIZ", timestamp: 1234567890 })
    dispatch({ type: "SELECT_OPTION", optionIndex: 2 })

    dispose()

    const history = getMessageHistory(doc)

    // Verify full message data is preserved
    expect(history[0].msg).toEqual({
      type: "START_QUIZ",
      timestamp: 1234567890,
    })
    expect(history[1].msg).toEqual({
      type: "SELECT_OPTION",
      optionIndex: 2,
    })
  })
})

describe("dispatch commit messages", () => {
  it("stores message as commit annotation", () => {
    const doc = createTypedDoc(QuizDocSchema)

    const { dispatch, dispose } = runtime({
      doc,
      questions: DEFAULT_QUESTIONS,
      reactors: [],
    })

    dispatch({ type: "START_QUIZ", timestamp: 1234567890 })

    dispose()

    // Get the change and verify the commit message
    const frontiers = loro(doc).doc.frontiers()
    const change = loro(doc).doc.getChangeAt(frontiers[0])

    expect(change.message).toBeDefined()
    if (!change.message) throw new Error("Expected commit message")

    const parsed = JSON.parse(change.message)
    expect(parsed.type).toBe("START_QUIZ")
    expect(parsed.msg.type).toBe("START_QUIZ")
    expect(parsed.msg.timestamp).toBe(1234567890)
    expect(parsed.timestamp).toBeGreaterThan(0)
  })
})
