import { createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { DEFAULT_QUESTIONS, QuizDocSchema } from "./schema.js"
import { getState, getTimestampFromFrontier, update } from "./update.js"

// ═══════════════════════════════════════════════════════════════════════════
// LEA 3.0 Quiz Challenge - Update Function Tests
// ═══════════════════════════════════════════════════════════════════════════
// These tests verify the state machine transitions are correct.

describe("Quiz Update Function", () => {
  function createDoc() {
    return createTypedDoc(QuizDocSchema)
  }

  describe("START_QUIZ", () => {
    it("transitions from idle to answering", () => {
      const doc = createDoc()
      const frontier = loro(doc).doc.frontiers()

      const newFrontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("answering")
      if (state.quiz.state.status === "answering") {
        expect(state.quiz.state.questionIndex).toBe(0)
        expect(state.quiz.state.selectedOption).toBe(null)
        // startedAt should be a recent timestamp (within last second)
        expect(state.quiz.state.startedAt).toBeGreaterThan(Date.now() - 1000)
      }
    })

    it("does nothing if not in idle state", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Start the quiz first
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      // Try to start again
      const newFrontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("answering")
    })
  })

  describe("SELECT_OPTION", () => {
    it("updates selected option while answering", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Start the quiz
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      // Select an option
      const newFrontier = update(
        doc,
        frontier,
        { type: "SELECT_OPTION", optionIndex: 2 },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      if (state.quiz.state.status === "answering") {
        expect(state.quiz.state.selectedOption).toBe(2)
      }
    })
  })

  // NOTE: TICK message removed - time is now calculated from startedAt in the UI
  // This ensures consistent timing across multiple tabs/peers

  describe("SUBMIT_ANSWER", () => {
    it("transitions from answering to submitted when option selected", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Start and select
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )
      frontier = update(
        doc,
        frontier,
        { type: "SELECT_OPTION", optionIndex: 0 },
        DEFAULT_QUESTIONS,
      )

      // Submit
      const newFrontier = update(
        doc,
        frontier,
        { type: "SUBMIT_ANSWER" },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("submitted")
      if (state.quiz.state.status === "submitted") {
        expect(state.quiz.state.selectedOption).toBe(0)
        expect(state.quiz.state.requestId).toMatch(/^req_/)
      }
    })

    it("does nothing if no option selected", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Start but don't select
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      // Try to submit
      const newFrontier = update(
        doc,
        frontier,
        { type: "SUBMIT_ANSWER" },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("answering") // Still answering
    })
  })

  describe("RECEIVE_FEEDBACK", () => {
    it("transitions from submitted to reviewing", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Start, select, submit
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )
      frontier = update(
        doc,
        frontier,
        { type: "SELECT_OPTION", optionIndex: 0 },
        DEFAULT_QUESTIONS,
      )
      frontier = update(
        doc,
        frontier,
        { type: "SUBMIT_ANSWER" },
        DEFAULT_QUESTIONS,
      )

      // Get the request ID
      const submittedState = getState(doc, frontier)
      const requestId =
        submittedState.quiz.state.status === "submitted"
          ? submittedState.quiz.state.requestId
          : ""

      // Receive feedback
      const newFrontier = update(
        doc,
        frontier,
        {
          type: "RECEIVE_FEEDBACK",
          requestId,
          isCorrect: true,
          feedback: "Great job!",
        },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("reviewing")
      if (state.quiz.state.status === "reviewing") {
        expect(state.quiz.state.isCorrect).toBe(true)
        expect(state.quiz.state.feedback).toBe("Great job!")
      }
    })
  })

  describe("NEXT_QUESTION", () => {
    it("transitions to next question", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      // Go through first question
      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )
      frontier = update(
        doc,
        frontier,
        { type: "SELECT_OPTION", optionIndex: 0 },
        DEFAULT_QUESTIONS,
      )
      frontier = update(
        doc,
        frontier,
        { type: "SUBMIT_ANSWER" },
        DEFAULT_QUESTIONS,
      )

      const submittedState = getState(doc, frontier)
      const requestId =
        submittedState.quiz.state.status === "submitted"
          ? submittedState.quiz.state.requestId
          : ""

      frontier = update(
        doc,
        frontier,
        {
          type: "RECEIVE_FEEDBACK",
          requestId,
          isCorrect: true,
          feedback: "Good!",
        },
        DEFAULT_QUESTIONS,
      )

      // Go to next question
      const newFrontier = update(
        doc,
        frontier,
        { type: "NEXT_QUESTION", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )

      const state = getState(doc, newFrontier)
      expect(state.quiz.state.status).toBe("answering")
      if (state.quiz.state.status === "answering") {
        expect(state.quiz.state.questionIndex).toBe(1)
      }
    })
  })

  describe("getTimestampFromFrontier", () => {
    it("returns a monotonically increasing value", () => {
      const doc = createDoc()
      let frontier = loro(doc).doc.frontiers()

      const t1 = getTimestampFromFrontier(frontier)

      frontier = update(
        doc,
        frontier,
        { type: "START_QUIZ", timestamp: Date.now() },
        DEFAULT_QUESTIONS,
      )
      const t2 = getTimestampFromFrontier(frontier)

      frontier = update(
        doc,
        frontier,
        { type: "SELECT_OPTION", optionIndex: 0 },
        DEFAULT_QUESTIONS,
      )
      const t3 = getTimestampFromFrontier(frontier)

      expect(t2).toBeGreaterThan(t1)
      expect(t3).toBeGreaterThan(t2)
    })
  })
})
