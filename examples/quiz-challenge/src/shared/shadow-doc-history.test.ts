import { createTypedDoc, loro } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { HistoryDocSchema } from "./history-schema.js"
import { QuizDocSchema } from "./schema.js"

// ═══════════════════════════════════════════════════════════════════════════
// Separate History Document Pattern
// ═══════════════════════════════════════════════════════════════════════════
//
// Problem: When the app document is checked out to a historical frontier,
// the history panel (which reads from the same document) doesn't see new
// changes arriving from other peers.
//
// Solution: Use TWO separate documents:
// 1. App document (`quiz-123`) - contains quiz state, can be checked out
// 2. History document (`quiz-123:history`) - contains history entries only,
//    NEVER checked out, always stays at latest
//
// When a message is dispatched:
// - App document: state is updated via the update function
// - History document: a new entry is appended via a reactor
//
// The history panel subscribes to the history document, which is completely
// independent of the app document's checkout state.

describe("separate history document pattern", () => {
  function createAppDoc() {
    return createTypedDoc(QuizDocSchema)
  }

  function createHistoryDoc() {
    return createTypedDoc(HistoryDocSchema)
  }

  // Simulates what a reactor would do: append entry to history doc
  function appendHistoryEntry(
    historyDoc: ReturnType<typeof createHistoryDoc>,
    msg: { type: string },
    timestamp: number,
  ) {
    historyDoc.change(draft => {
      draft.entries.push({
        id: `${Date.now()}-${Math.random()}`,
        msgType: msg.type,
        msgJson: JSON.stringify(msg),
        timestamp,
      })
    })
  }

  it("history doc is independent of app doc checkout state", () => {
    // === SETUP: Create both documents ===
    const appDoc = createAppDoc()
    const historyDoc = createHistoryDoc()

    // === Simulate app actions with history tracking ===
    // Action 1: START_QUIZ
    appDoc.change(draft => {
      draft.quiz.state = {
        status: "answering",
        questionIndex: 0,
        selectedOption: null,
        startedAt: 1000,
      }
    })
    appendHistoryEntry(historyDoc, { type: "START_QUIZ" }, 1000)

    // Action 2: SELECT_OPTION
    appDoc.change(draft => {
      if (draft.quiz.state.status === "answering") {
        draft.quiz.state.selectedOption = 0
      }
    })
    appendHistoryEntry(historyDoc, { type: "SELECT_OPTION" }, 1001)

    // Save frontier for checkout
    const checkoutFrontier = loro(appDoc).doc.frontiers()

    // Action 3: SUBMIT_ANSWER
    appDoc.change(draft => {
      if (draft.quiz.state.status === "answering") {
        draft.quiz.state = {
          status: "submitted",
          questionIndex: 0,
          selectedOption: 0,
          submittedAt: 1002,
          requestId: "req-1",
        }
      }
    })
    appendHistoryEntry(historyDoc, { type: "SUBMIT_ANSWER" }, 1002)

    // === USER ACTION: Check out app doc to historical state ===
    loro(appDoc).doc.checkout(checkoutFrontier)

    // === VERIFY: App doc is detached ===
    expect(loro(appDoc).doc.isDetached()).toBe(true)

    // === VERIFY: History doc is NOT detached (never was) ===
    expect(loro(historyDoc).doc.isDetached()).toBe(false)

    // === VERIFY: History doc has all 3 entries ===
    const entries = historyDoc.toJSON().entries
    expect(entries.length).toBe(3)
    expect(entries[0].msgType).toBe("START_QUIZ")
    expect(entries[1].msgType).toBe("SELECT_OPTION")
    expect(entries[2].msgType).toBe("SUBMIT_ANSWER")
  })

  it("history doc receives new entries while app doc is checked out", () => {
    // === SETUP ===
    const appDoc = createAppDoc()
    const historyDoc = createHistoryDoc()

    // Initial action
    appDoc.change(draft => {
      draft.quiz.state = {
        status: "answering",
        questionIndex: 0,
        selectedOption: null,
        startedAt: 1000,
      }
    })
    appendHistoryEntry(historyDoc, { type: "START_QUIZ" }, 1000)

    // Save frontier BEFORE making more changes
    const checkoutFrontier = loro(appDoc).doc.frontiers()

    // Make another change so we have something to checkout FROM
    appDoc.change(draft => {
      if (draft.quiz.state.status === "answering") {
        draft.quiz.state.selectedOption = 0
      }
    })
    appendHistoryEntry(historyDoc, { type: "SELECT_OPTION" }, 1001)

    // Checkout app doc to PREVIOUS frontier
    loro(appDoc).doc.checkout(checkoutFrontier)
    expect(loro(appDoc).doc.isDetached()).toBe(true)

    // === Track subscription on history doc ===
    let subscriptionFired = false
    const unsub = loro(historyDoc).subscribe(() => {
      subscriptionFired = true
    })

    // === Simulate peer making new changes ===
    // (In real app, this would come via sync)
    appendHistoryEntry(historyDoc, { type: "SELECT_OPTION" }, 2000)
    appendHistoryEntry(historyDoc, { type: "SUBMIT_ANSWER" }, 2001)

    unsub()

    // === VERIFY: Subscription fired ===
    expect(subscriptionFired).toBe(true)

    // === VERIFY: History doc has all entries ===
    const entries = historyDoc.toJSON().entries
    expect(entries.length).toBe(4) // START_QUIZ, SELECT_OPTION (before checkout), SUBMIT_ANSWER, NEXT_QUESTION (after checkout)

    // === VERIFY: App doc is still checked out ===
    expect(loro(appDoc).doc.isDetached()).toBe(true)
  })

  it("demonstrates the full decoupled pattern", () => {
    // This test shows the complete architecture:
    // - App doc: `quiz-123` - for app state
    // - History doc: `quiz-123:history` - for history panel

    const appDoc = createAppDoc()
    const historyDoc = createHistoryDoc()

    // === Browser A: Start quiz and make progress ===
    appDoc.change(draft => {
      draft.quiz.state = {
        status: "answering",
        questionIndex: 0,
        selectedOption: null,
        startedAt: 1000,
      }
    })
    appendHistoryEntry(historyDoc, { type: "START_QUIZ" }, 1000)

    // Save frontier BEFORE making more changes
    const checkoutFrontier = loro(appDoc).doc.frontiers()

    appDoc.change(draft => {
      if (draft.quiz.state.status === "answering") {
        draft.quiz.state.selectedOption = 0
      }
    })
    appendHistoryEntry(historyDoc, { type: "SELECT_OPTION" }, 1001)

    // Browser A checks out to view history (to PREVIOUS frontier)
    loro(appDoc).doc.checkout(checkoutFrontier)
    expect(loro(appDoc).doc.isDetached()).toBe(true)

    // === Browser B: Continues the quiz (simulated via direct writes) ===
    // In real app, these would sync via repo
    appendHistoryEntry(historyDoc, { type: "SUBMIT_ANSWER" }, 2000)
    appendHistoryEntry(historyDoc, { type: "NEXT_QUESTION" }, 2001)
    appendHistoryEntry(historyDoc, { type: "SELECT_OPTION" }, 2002)

    // === VERIFY: History doc shows ALL entries ===
    const entries = historyDoc.toJSON().entries
    expect(entries.length).toBe(5)
    expect(entries.map(e => e.msgType)).toEqual([
      "START_QUIZ",
      "SELECT_OPTION",
      "SUBMIT_ANSWER",
      "NEXT_QUESTION",
      "SELECT_OPTION",
    ])

    // === VERIFY: App doc is still checked out ===
    expect(loro(appDoc).doc.isDetached()).toBe(true)

    // === CONCLUSION ===
    // The history document is completely independent:
    // 1. It has its own schema (list of history entries)
    // 2. It's never checked out
    // 3. It receives updates regardless of app doc state
    // 4. The history panel subscribes to it for real-time updates
  })
})
