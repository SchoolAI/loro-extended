/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { describe, expect, it } from "vitest"

import { createPermissions } from "./auth/permission-adapter.js"
import {
  type Command,
  type Message,
  type Model,
  init as programInit,
  update,
} from "./synchronizer-program.js"

describe("Synchronizer program", () => {
  it("should initialize correctly", () => {
    const [model, command] = programInit(createPermissions())
    expect(model.peers.size).toBe(0)
    expect(model.docAvailability.size).toBe(0)
    expect(model.localDocs.size).toBe(0)
    expect(model.syncStates.size).toBe(0)
    expect(command).toBeUndefined()
  })

  it("should add a peer and announce local documents", () => {
    const [initialModel] = programInit(createPermissions())
    const documentId = "doc-1"
    const modelWithDoc: Model = {
      ...initialModel,
      localDocs: new Set([documentId]),
    }

    const message: Message = { type: "msg-peer-added", peerId: "peer-1" }
    const [newModel, command] = update(message, modelWithDoc)

    expect(newModel.peers.has("peer-1")).toBe(true)
    expect(command).toEqual({
      type: "cmd-send-message",
      message: {
        type: "announce-document",
        documentIds: [documentId],
        targetIds: ["peer-1"],
      },
    })
  })

  it("should remove a peer and its document availability", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithPeer: Model = {
      ...initialModel,
      peers: new Set(["peer-1", "peer-2"]),
      docAvailability: new Map([
        ["doc-1", new Set(["peer-1", "peer-2"])],
        ["doc-2", new Set(["peer-1"])],
      ]),
    }

    const message: Message = { type: "msg-peer-removed", peerId: "peer-1" }
    const [newModel, command] = update(message, modelWithPeer)

    expect(newModel.peers.has("peer-1")).toBe(false)
    expect(newModel.peers.has("peer-2")).toBe(true)
    expect(newModel.docAvailability.get("doc-1")?.has("peer-1")).toBe(false)
    expect(newModel.docAvailability.get("doc-1")?.has("peer-2")).toBe(true)
    expect(newModel.docAvailability.get("doc-2")?.has("peer-1")).toBe(false)
    expect(command).toBeUndefined()
  })

  it("should start syncing when a document is requested", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithPeer: Model = {
      ...initialModel,
      peers: new Set(["peer-1"]),
    }

    const message: Message = { type: "msg-sync-started", documentId: "doc-1" }
    const [newModel, command] = update(message, modelWithPeer)

    const syncState = newModel.syncStates.get("doc-1")
    expect(syncState?.state).toBe("searching")

    expect(command).toEqual({
      type: "cmd-batch",
      commands: [
        {
          type: "cmd-send-message",
          message: {
            type: "request-sync",
            documentId: "doc-1",
            targetIds: ["peer-1"],
          },
        },
        {
          type: "cmd-set-timeout",
          documentId: "doc-1",
          duration: 5000,
        },
      ],
    })
  })

  it("should transition from searching to syncing when an announcement is received", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithSyncState: Model = {
      ...initialModel,
      peers: new Set(["peer-1"]),
      syncStates: new Map([["doc-1", { state: "searching", retryCount: 0 }]]),
    }

    const message: Message = {
      type: "msg-received-doc-announced",
      from: "peer-1",
      documentIds: ["doc-1"],
    }
    const [newModel, command] = update(message, modelWithSyncState)

    const syncState = newModel.syncStates.get("doc-1")
    expect(syncState?.state).toBe("syncing")
    expect((syncState as any).peerId).toBe("peer-1")

    expect(command).toEqual({
      type: "cmd-batch",
      commands: [
        { type: "cmd-clear-timeout", documentId: "doc-1" },
        {
          type: "cmd-send-message",
          message: {
            type: "request-sync",
            documentId: "doc-1",
            targetIds: ["peer-1"],
          },
        },
        { type: "cmd-set-timeout", documentId: "doc-1", duration: 25000 },
      ],
    })
  })

  it("should respond to a sync request if the document is available", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithDoc: Model = {
      ...initialModel,
      localDocs: new Set(["doc-1"]),
    }

    const message: Message = {
      type: "msg-received-doc-request",
      from: "peer-1",
      documentId: "doc-1",
    }
    const [, command] = update(message, modelWithDoc)

    expect(command).toEqual({
      type: "cmd-load-and-send-sync",
      documentId: "doc-1",
      to: "peer-1",
    })
  })

  it("should clear sync state on successful sync", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithSyncState: Model = {
      ...initialModel,
      syncStates: new Map([
        ["doc-1", { state: "syncing", peerId: "peer-1", retryCount: 0 }],
      ]),
    }

    const message: Message = {
      type: "msg-received-sync",
      from: "peer-1",
      documentId: "doc-1",
      data: new Uint8Array([1, 2, 3]),
    }
    const [newModel, command] = update(message, modelWithSyncState)

    expect(newModel.syncStates.has("doc-1")).toBe(false)
    expect(command).toEqual({
      type: "cmd-batch",
      commands: [
        { type: "cmd-clear-timeout", documentId: "doc-1" },
        {
          type: "cmd-sync-succeeded",
          documentId: "doc-1",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    })
  })

  it("should retry with backoff on timeout and eventually fail", () => {
    const [initialModel] = programInit(createPermissions())
    let model: Model = {
      ...initialModel,
      syncStates: new Map([["doc-1", { state: "searching", retryCount: 0 }]]),
    }
    let command: Command | undefined

    // First timeout
    ;[model, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )
    expect(model.syncStates.get("doc-1")?.retryCount).toBe(1)
    expect((command as any).commands[1].duration).toBe(10000)

    // Second timeout
    ;[model, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )
    expect(model.syncStates.get("doc-1")?.retryCount).toBe(2)
    expect((command as any).commands[1].duration).toBe(20000)

    // Third timeout
    ;[model, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )
    expect(model.syncStates.get("doc-1")?.retryCount).toBe(3)
    expect((command as any).commands[1].duration).toBe(40000)

    // Final timeout - should fail
    ;[model, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )
    expect(model.syncStates.has("doc-1")).toBe(false)
    expect(command).toEqual({
      type: "cmd-batch",
      commands: [
        {
          documentId: "doc-1",
          type: "cmd-clear-timeout",
        },
        {
          documentId: "doc-1",
          requestId: undefined,
          type: "cmd-sync-failed",
        },
      ],
    })
  })
  it("should not announce a new document to a peer if canList returns false", () => {
    const [initialModel] = programInit(
      createPermissions({
        canList: (peerId, documentId) => {
          if (peerId === "peer-2" && documentId === "doc-1") return false
          return true
        },
      }),
    )
    const modelWithPeers: Model = {
      ...initialModel,
      peers: new Set(["peer-1", "peer-2"]),
    }

    const message: Message = { type: "msg-document-added", documentId: "doc-1" }
    const [, command] = update(message, modelWithPeers)

    expect((command as any).message.targetIds).toEqual(["peer-1"])
  })

  it("should not apply a sync message if canWrite returns false", () => {
    const [initialModel] = programInit(
      createPermissions({
        canWrite: (peerId, documentId) => {
          if (peerId === "peer-1" && documentId === "doc-1") return false
          return true
        },
      }),
    )
    const modelWithSyncState: Model = {
      ...initialModel,
      syncStates: new Map([
        ["doc-1", { state: "syncing", peerId: "peer-1", retryCount: 0 }],
      ]),
    }

    const message: Message = {
      type: "msg-received-sync",
      from: "peer-1",
      documentId: "doc-1",
      data: new Uint8Array([1, 2, 3]),
    }

    const [newModel, command] = update(message, modelWithSyncState)

    expect(newModel.syncStates.has("doc-1")).toBe(true)
    expect(command).toBeUndefined()
  })

  it("should send a sync message to all available peers on local change", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithAvailability: Model = {
      ...initialModel,
      docAvailability: new Map([
        ["doc-1", new Set(["peer-1", "peer-2"])],
        ["doc-2", new Set(["peer-2"])],
      ]),
    }

    const message: Message = {
      type: "msg-local-change",
      documentId: "doc-1",
      data: new Uint8Array([1, 2, 3]),
    }

    const [, command] = update(message, modelWithAvailability)

    expect((command as any).message.targetIds).toEqual(["peer-1", "peer-2"])
    expect((command as any).message.data).toEqual(new Uint8Array([1, 2, 3]))
  })
})
