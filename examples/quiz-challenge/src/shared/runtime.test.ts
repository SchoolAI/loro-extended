import { createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import type { Reactor, Transition } from "./reactor-types.js"
import { entered, exited } from "./reactor-types.js"
import { runtime } from "./runtime.js"
import { DEFAULT_QUESTIONS, QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Tests - Lazy TypedDoc Transitions
// ═══════════════════════════════════════════════════════════════════════════
//
// These tests verify the core contract of the optimized runtime:
// 1. Reactors receive TypedDoc proxies (not plain JSON)
// 2. The before/after states reflect correct frontiers
// 3. Helper functions work with TypedDoc

describe("runtime", () => {
  describe("lazy TypedDoc transitions", () => {
    it("should pass TypedDoc proxies to reactors, not plain JSON", () => {
      const doc = createTypedDoc(QuizDocSchema)
      const transitions: Transition[] = []

      const captureReactor: Reactor = transition => {
        transitions.push(transition)
      }

      const { dispatch, dispose } = runtime({
        doc,
        questions: DEFAULT_QUESTIONS,
        reactors: [captureReactor],
      })

      // Dispatch a message to trigger a transition
      dispatch({ type: "START_QUIZ", timestamp: Date.now() })

      // Verify we received a transition
      expect(transitions.length).toBe(1)

      const { before, after } = transitions[0]

      // Key assertion: These are TypedDoc proxies, not plain objects
      // TypedDoc has a .toJSON() method, plain objects don't have it as a function
      expect(typeof before.toJSON).toBe("function")
      expect(typeof after.toJSON).toBe("function")

      // Verify the state is correct
      expect(before.quiz.state.status).toBe("idle")
      expect(after.quiz.state.status).toBe("answering")

      dispose()
    })

    it("should capture correct before/after frontiers across multiple transitions", () => {
      const doc = createTypedDoc(QuizDocSchema)
      const transitions: Transition[] = []

      const captureReactor: Reactor = transition => {
        transitions.push(transition)
      }

      const { dispatch, dispose } = runtime({
        doc,
        questions: DEFAULT_QUESTIONS,
        reactors: [captureReactor],
      })

      // First transition: idle → answering
      dispatch({ type: "START_QUIZ", timestamp: Date.now() })

      // Second transition: select an option
      dispatch({ type: "SELECT_OPTION", optionIndex: 0 })

      expect(transitions.length).toBe(2)

      // First transition: before=idle, after=answering
      expect(transitions[0].before.quiz.state.status).toBe("idle")
      expect(transitions[0].after.quiz.state.status).toBe("answering")

      // Second transition: before=answering (no selection), after=answering (with selection)
      expect(transitions[1].before.quiz.state.status).toBe("answering")
      expect(transitions[1].after.quiz.state.status).toBe("answering")

      // Verify the selection changed
      const beforeState = transitions[1].before.quiz.state
      const afterState = transitions[1].after.quiz.state
      if (
        beforeState.status === "answering" &&
        afterState.status === "answering"
      ) {
        expect(beforeState.selectedOption).toBe(null)
        expect(afterState.selectedOption).toBe(0)
      }

      dispose()
    })

    it("should provide independent forks that don't affect each other", () => {
      const doc = createTypedDoc(QuizDocSchema)
      let capturedTransition: Transition | null = null

      const captureReactor: Reactor = transition => {
        capturedTransition = transition
      }

      const { dispatch, dispose } = runtime({
        doc,
        questions: DEFAULT_QUESTIONS,
        reactors: [captureReactor],
      })

      dispatch({ type: "START_QUIZ", timestamp: Date.now() })

      // The before and after should be independent forks
      expect(capturedTransition).not.toBeNull()
      if (capturedTransition === null) throw new Error("Expected transition")
      const { before, after } = capturedTransition

      // Get the underlying LoroDoc peer IDs - they should be different
      // (forks get new peer IDs)
      const beforePeerId = loro(before).doc.peerId
      const afterPeerId = loro(after).doc.peerId

      // Both should be different from the main doc
      const mainPeerId = loro(doc).doc.peerId
      expect(beforePeerId).not.toBe(mainPeerId)
      expect(afterPeerId).not.toBe(mainPeerId)

      dispose()
    })
  })

  describe("helper functions with TypedDoc", () => {
    it("entered() should detect status transitions with TypedDoc", () => {
      const doc = createTypedDoc(QuizDocSchema)
      const initialFrontier = loro(doc).doc.frontiers()

      // Make a change
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })

      const afterFrontier = loro(doc).doc.frontiers()

      // Create TypedDoc forks (simulating what runtime does)
      const before = doc.forkAt(initialFrontier)
      const after = doc.forkAt(afterFrontier)

      // Test entered()
      expect(entered("answering", before, after)).toBe(true)
      expect(entered("idle", before, after)).toBe(false)
      expect(entered("submitted", before, after)).toBe(false)
    })

    it("exited() should detect status transitions with TypedDoc", () => {
      const doc = createTypedDoc(QuizDocSchema)
      const initialFrontier = loro(doc).doc.frontiers()

      // Make a change
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })

      const afterFrontier = loro(doc).doc.frontiers()

      const before = doc.forkAt(initialFrontier)
      const after = doc.forkAt(afterFrontier)

      // Test exited()
      expect(exited("idle", before, after)).toBe(true)
      expect(exited("answering", before, after)).toBe(false)
      expect(exited("submitted", before, after)).toBe(false)
    })
  })

  describe("Record access with TypedDoc", () => {
    it("should access sensor records using .get() method", () => {
      const doc = createTypedDoc(QuizDocSchema)

      // Add a feedback response
      doc.change(draft => {
        draft.sensors.feedbackResponses.set("req_123", {
          isCorrect: true,
          feedback: "Great job!",
          receivedAt: Date.now(),
        })
      })

      const frontier = loro(doc).doc.frontiers()
      const forkedDoc = doc.forkAt(frontier)

      // Access using .get() - this is how reactors access records
      const response = forkedDoc.sensors.feedbackResponses.get("req_123")
      expect(response).toBeDefined()
      expect(response?.isCorrect).toBe(true)
      expect(response?.feedback).toBe("Great job!")

      // Non-existent key should return undefined
      const missing = forkedDoc.sensors.feedbackResponses.get("nonexistent")
      expect(missing).toBeUndefined()
    })
  })
})
