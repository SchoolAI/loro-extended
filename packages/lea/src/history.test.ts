import { createTypedDoc } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import {
  appendHistoryEntry,
  getHistoryDocId,
  getHistoryEntries,
  HistoryDocSchema,
} from "./history.js"

// ═══════════════════════════════════════════════════════════════════════════
// Test Message Type
// ═══════════════════════════════════════════════════════════════════════════

type TestMsg =
  | { type: "START"; timestamp: number }
  | { type: "INCREMENT" }
  | { type: "SET_VALUE"; value: number }

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("getHistoryDocId", () => {
  it("appends :history suffix to app doc ID", () => {
    expect(getHistoryDocId("quiz-123")).toBe("quiz-123:history")
  })

  it("works with various ID formats", () => {
    expect(getHistoryDocId("my-app")).toBe("my-app:history")
    expect(getHistoryDocId("doc_abc_123")).toBe("doc_abc_123:history")
    expect(getHistoryDocId("")).toBe(":history")
  })
})

describe("appendHistoryEntry", () => {
  it("appends an entry to the history document", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)
    const msg: TestMsg = { type: "START", timestamp: 1000 }

    appendHistoryEntry(historyDoc, msg, 1000)

    const entries = historyDoc.toJSON().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].msgType).toBe("START")
    expect(entries[0].timestamp).toBe(1000)
    expect(JSON.parse(entries[0].msgJson)).toEqual(msg)
  })

  it("appends multiple entries in order", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)

    appendHistoryEntry(historyDoc, { type: "START", timestamp: 1000 }, 1000)
    appendHistoryEntry(historyDoc, { type: "INCREMENT" }, 2000)
    appendHistoryEntry(historyDoc, { type: "SET_VALUE", value: 42 }, 3000)

    const entries = historyDoc.toJSON().entries
    expect(entries).toHaveLength(3)
    expect(entries[0].msgType).toBe("START")
    expect(entries[1].msgType).toBe("INCREMENT")
    expect(entries[2].msgType).toBe("SET_VALUE")
  })

  it("generates unique IDs for each entry", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)

    appendHistoryEntry(historyDoc, { type: "INCREMENT" }, 1000)
    appendHistoryEntry(historyDoc, { type: "INCREMENT" }, 1000)

    const entries = historyDoc.toJSON().entries
    expect(entries[0].id).not.toBe(entries[1].id)
  })

  it("handles messages without type property", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)
    const msg = { value: 123 } // No type property

    appendHistoryEntry(historyDoc, msg, 1000)

    const entries = historyDoc.toJSON().entries
    expect(entries[0].msgType).toBe("unknown")
  })
})

describe("getHistoryEntries", () => {
  it("returns empty array for empty history", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)
    const entries = getHistoryEntries<TestMsg>(historyDoc)
    expect(entries).toEqual([])
  })

  it("returns parsed entries with original message objects", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)
    const msg1: TestMsg = { type: "START", timestamp: 1000 }
    const msg2: TestMsg = { type: "SET_VALUE", value: 42 }

    appendHistoryEntry(historyDoc, msg1, 1000)
    appendHistoryEntry(historyDoc, msg2, 2000)

    const entries = getHistoryEntries<TestMsg>(historyDoc)

    expect(entries).toHaveLength(2)
    expect(entries[0].msg).toEqual(msg1)
    expect(entries[0].timestamp).toBe(1000)
    expect(entries[1].msg).toEqual(msg2)
    expect(entries[1].timestamp).toBe(2000)
  })

  it("preserves entry IDs", () => {
    const historyDoc = createTypedDoc(HistoryDocSchema)
    appendHistoryEntry(historyDoc, { type: "INCREMENT" }, 1000)

    const rawEntries = historyDoc.toJSON().entries
    const parsedEntries = getHistoryEntries<TestMsg>(historyDoc)

    expect(parsedEntries[0].id).toBe(rawEntries[0].id)
  })
})
