/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"

describe("Synchronizer - Document Management", () => {
  let synchronizer: Synchronizer

  beforeEach(() => {
    synchronizer = new Synchronizer({
      identity: { name: "test-synchronizer" },
      adapters: [],
      permissions: createPermissions(),
    })
  })

  it("should create document state when requested", () => {
    const docId = "test-doc"
    const docState = synchronizer.getOrCreateDocumentState(docId)

    expect(docState).toBeDefined()
    expect(docState.docId).toBe(docId)
    expect(docState.doc).toBeInstanceOf(LoroDoc)
  })

  it("should return existing document state", () => {
    const docId = "test-doc"
    const docState1 = synchronizer.getOrCreateDocumentState(docId)
    const docState2 = synchronizer.getOrCreateDocumentState(docId)

    expect(docState1).toBe(docState2)
  })

  it("should return undefined for non-existent document", () => {
    const docState = synchronizer.getDocumentState("non-existent")
    expect(docState).toBeUndefined()
  })

  it("should get model snapshot", () => {
    const docId = "test-doc"
    synchronizer.getOrCreateDocumentState(docId)

    const snapshot = synchronizer.getModelSnapshot()
    expect(snapshot.identity).toEqual(synchronizer.identity)
    expect(snapshot.documents.has(docId)).toBe(true)
    expect(snapshot.channels).toBeInstanceOf(Map)
  })
})