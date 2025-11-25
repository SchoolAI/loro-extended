import type { PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import { createPermissions } from "../rules.js"
import {
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
} from "../synchronizer-program.js"
import { createDocState } from "../types.js"

describe("handle-local-doc-delete", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  it("should delete document from model", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })

    // Add a document
    const docState = createDocState({ docId: "test-doc" })
    initialModel.documents.set("test-doc", docState)

    expect(initialModel.documents.has("test-doc")).toBe(true)

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-delete",
      docId: "test-doc",
    }

    const [newModel, command] = update(message, initialModel)

    // Document should be removed
    expect(newModel.documents.has("test-doc")).toBe(false)
    // Should not return any command
    expect(command).toBeUndefined()
  })

  it("should log warning when document doesn't exist", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-delete",
      docId: "nonexistent-doc",
    }

    const [newModel, command] = update(message, initialModel)

    // Model should be unchanged
    expect(newModel).toBe(initialModel)
    // Should log warning
    expect(command).toBeUndefined()
  })

  it("should be idempotent - safe to call multiple times", () => {
    const [initialModel] = programInit({
      peerId: "test-id" as PeerID,
      name: "test",
      type: "user",
    })

    // Add a document
    const docState = createDocState({ docId: "test-doc" })
    initialModel.documents.set("test-doc", docState)

    const message: SynchronizerMessage = {
      type: "synchronizer/doc-delete",
      docId: "test-doc",
    }

    // Delete once
    const [model1, cmd1] = update(message, initialModel)
    expect(model1.documents.has("test-doc")).toBe(false)
    expect(cmd1).toBeUndefined()

    // Delete again - should just log warning
    const [model2, cmd2] = update(message, model1)
    expect(model2.documents.has("test-doc")).toBe(false)

    expect(cmd2).toBeUndefined()
  })
})
