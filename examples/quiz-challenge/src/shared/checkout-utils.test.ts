import { createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { checkoutToFrontier, isLatestFrontier } from "./checkout-utils.js"
import { QuizDocSchema } from "./schema.js"

describe("checkout-utils", () => {
  describe("isLatestFrontier", () => {
    it("returns true for empty doc with empty frontier", () => {
      const doc = createTypedDoc(QuizDocSchema)
      expect(isLatestFrontier(loro(doc).doc, [])).toBe(true)
    })

    it("returns true when frontier matches oplog frontiers", () => {
      const doc = createTypedDoc(QuizDocSchema)
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })
      const frontiers = loro(doc).doc.frontiers()
      expect(isLatestFrontier(loro(doc).doc, frontiers)).toBe(true)
    })

    it("returns false for historical frontier", () => {
      const doc = createTypedDoc(QuizDocSchema)
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })
      const historicalFrontier = loro(doc).doc.frontiers()

      doc.change(draft => {
        if (draft.quiz.state.status === "answering") {
          draft.quiz.state.selectedOption = 1
        }
      })

      expect(isLatestFrontier(loro(doc).doc, historicalFrontier)).toBe(false)
    })
  })

  describe("checkoutToFrontier", () => {
    it("uses checkoutToLatest when frontier is latest", () => {
      const doc = createTypedDoc(QuizDocSchema)

      // Make a change
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })

      const latestFrontier = loro(doc).doc.frontiers()

      // Checkout to latest frontier should NOT leave doc detached
      checkoutToFrontier(loro(doc).doc, latestFrontier)

      expect(loro(doc).doc.isDetached()).toBe(false)
    })

    it("uses checkout when frontier is historical", () => {
      const doc = createTypedDoc(QuizDocSchema)

      // Make first change
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })

      const historicalFrontier = loro(doc).doc.frontiers()

      // Make second change
      doc.change(draft => {
        if (draft.quiz.state.status === "answering") {
          draft.quiz.state.selectedOption = 1
        }
      })

      // Checkout to historical frontier should leave doc detached
      checkoutToFrontier(loro(doc).doc, historicalFrontier)

      expect(loro(doc).doc.isDetached()).toBe(true)
    })

    it("handles empty frontier (initial state)", () => {
      const doc = createTypedDoc(QuizDocSchema)

      // Make a change
      doc.change(draft => {
        draft.quiz.state = {
          status: "answering",
          questionIndex: 0,
          selectedOption: null,
          startedAt: Date.now(),
        }
      })

      // Checkout to empty frontier (initial state)
      checkoutToFrontier(loro(doc).doc, [])

      // Should be detached since empty frontier is not the latest
      expect(loro(doc).doc.isDetached()).toBe(true)

      // State should be back to initial
      expect(doc.toJSON().quiz.state.status).toBe("idle")
    })
  })
})
