/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { describe, expect, it } from "vitest"

import { createPermissions } from "./permission-adapter.js"
import {
  type Message,
  type Model,
  init as programInit,
  update,
} from "./synchronizer-program.js"

describe("Synchronizer program", () => {
  it("should initialize correctly", () => {
    const [model, command] = programInit(createPermissions())
    expect(model.peers.size).toBe(0)
    expect(model.peersWithDoc.size).toBe(0)
    expect(model.peersAwareOfDoc.size).toBe(0)
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
      peersWithDoc: new Map([
        ["doc-1", new Set(["peer-1", "peer-2"])],
        ["doc-2", new Set(["peer-1"])],
      ]),
      peersAwareOfDoc: new Map([
        ["doc-1", new Set(["peer-1", "peer-2"])],
        ["doc-2", new Set(["peer-1"])],
      ]),
    }

    const message: Message = { type: "msg-peer-removed", peerId: "peer-1" }
    const [newModel, command] = update(message, modelWithPeer)

    expect(newModel.peers.has("peer-1")).toBe(false)
    expect(newModel.peers.has("peer-2")).toBe(true)
    expect(newModel.peersWithDoc.get("doc-1")?.has("peer-1")).toBe(false)
    expect(newModel.peersWithDoc.get("doc-1")?.has("peer-2")).toBe(true)
    expect(newModel.peersWithDoc.get("doc-2")?.has("peer-1")).toBe(false)
    expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-1")).toBe(false)
    expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-2")).toBe(true)
    expect(newModel.peersAwareOfDoc.get("doc-2")?.has("peer-1")).toBe(false)
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
      syncStates: new Map([["doc-1", { state: "searching" }]]),
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
        { type: "cmd-set-timeout", documentId: "doc-1", duration: 5000 },
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
      type: "cmd-check-storage-and-respond",
      documentId: "doc-1",
      to: "peer-1",
    })
  })

  it("should clear sync state on successful sync", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithSyncState: Model = {
      ...initialModel,
      syncStates: new Map([["doc-1", { state: "syncing", peerId: "peer-1" }]]),
    }

    const message: Message = {
      type: "msg-received-sync",
      from: "peer-1",
      documentId: "doc-1",
      data: new Uint8Array([1, 2, 3]),
      hopCount: 0, // Original message
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

  it("should fail immediately on timeout with no retries", () => {
    const [initialModel] = programInit(createPermissions())
    const model: Model = {
      ...initialModel,
      syncStates: new Map([["doc-1", { state: "searching" }]]),
    }

    // Timeout should immediately fail
    const [newModel, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )

    expect(newModel.syncStates.has("doc-1")).toBe(false)
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

  it("should respect user timeout when specified", () => {
    const [initialModel] = programInit(createPermissions())
    const model: Model = {
      ...initialModel,
      syncStates: new Map([
        ["doc-1", { state: "searching", userTimeout: 3000, requestId: 0 }],
      ]),
    }

    // Timeout with user-specified timeout should fail immediately
    const [newModel, command] = update(
      { type: "msg-sync-timeout-fired", documentId: "doc-1" },
      model,
    )

    expect(newModel.syncStates.has("doc-1")).toBe(false)
    expect(command).toEqual({
      type: "cmd-batch",
      commands: [
        {
          documentId: "doc-1",
          type: "cmd-clear-timeout",
        },
        {
          documentId: "doc-1",
          requestId: 0,
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
      hopCount: 0, // Original message
    }

    const [newModel, command] = update(message, modelWithSyncState)

    expect(newModel.syncStates.has("doc-1")).toBe(true)
    expect(command).toBeUndefined()
  })

  it("should send a sync message to all aware peers on local change", () => {
    const [initialModel] = programInit(createPermissions())
    const modelWithAvailability: Model = {
      ...initialModel,
      peersAwareOfDoc: new Map([
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

  describe("Bug fix: Local document awareness tracking", () => {
    it("should track peer awareness when announcing documents to a new peer", () => {
      const [initialModel] = programInit(createPermissions())
      const modelWithDoc: Model = {
        ...initialModel,
        localDocs: new Set(["doc-1", "doc-2"]),
      }

      const message: Message = { type: "msg-peer-added", peerId: "peer-1" }
      const [newModel] = update(message, modelWithDoc)

      // Peer should now be aware of our local documents
      expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-1")).toBe(true)
      expect(newModel.peersAwareOfDoc.get("doc-2")?.has("peer-1")).toBe(true)
    })

    it("should track peer awareness when adding a new document", () => {
      const [initialModel] = programInit(createPermissions())
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Set(["peer-1", "peer-2"]),
      }

      const message: Message = {
        type: "msg-document-added",
        documentId: "doc-1",
      }
      const [newModel] = update(message, modelWithPeers)

      // All peers should be aware of the new document
      expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-1")).toBe(true)
      expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-2")).toBe(true)
    })

    it("should send local changes to aware peers after document creation", () => {
      const [initialModel] = programInit(createPermissions())

      // Step 1: Start with a peer
      const model: Model = {
        ...initialModel,
        peers: new Set(["peer-1"]),
      }

      // Step 2: Add a document locally
      const addDocMessage: Message = {
        type: "msg-document-added",
        documentId: "doc-1",
      }
      const [modelAfterAdd] = update(addDocMessage, model)

      // Verify peer is aware
      expect(modelAfterAdd.peersAwareOfDoc.get("doc-1")?.has("peer-1")).toBe(
        true,
      )

      // Step 3: Make a local change
      const changeMessage: Message = {
        type: "msg-local-change",
        documentId: "doc-1",
        data: new Uint8Array([1, 2, 3]),
      }
      const [, command] = update(changeMessage, modelAfterAdd)

      // Should send sync to the aware peer
      expect(command).toBeDefined()
      expect((command as any).message.type).toBe("sync")
      expect((command as any).message.targetIds).toEqual(["peer-1"])
      expect((command as any).message.documentId).toBe("doc-1")
    })

    it("should track peer awareness when peer requests a document", () => {
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
      const [newModel] = update(message, modelWithDoc)

      // Peer should now be aware of the document they requested
      expect(newModel.peersAwareOfDoc.get("doc-1")?.has("peer-1")).toBe(true)
    })

    it("should distinguish between peersWithDoc and peersAwareOfDoc", () => {
      const [initialModel] = programInit(createPermissions())

      // Peer announces they have doc-1
      const announceMessage: Message = {
        type: "msg-received-doc-announced",
        from: "peer-1",
        documentIds: ["doc-1"],
      }
      const [modelAfterAnnounce] = update(announceMessage, initialModel)

      // Peer-1 should be in both maps for doc-1
      expect(modelAfterAnnounce.peersWithDoc.get("doc-1")?.has("peer-1")).toBe(
        true,
      )
      expect(
        modelAfterAnnounce.peersAwareOfDoc.get("doc-1")?.has("peer-1"),
      ).toBe(true)

      // Now we add doc-2 locally and announce to peer-1
      const modelWithPeer: Model = {
        ...modelAfterAnnounce,
        peers: new Set(["peer-1"]),
      }
      const addDocMessage: Message = {
        type: "msg-document-added",
        documentId: "doc-2",
      }
      const [modelAfterAdd] = update(addDocMessage, modelWithPeer)

      // Peer-1 should only be in peersAwareOfDoc for doc-2 (not peersWithDoc)
      expect(modelAfterAdd.peersWithDoc.get("doc-2")?.has("peer-1")).toBeFalsy()
      expect(modelAfterAdd.peersAwareOfDoc.get("doc-2")?.has("peer-1")).toBe(
        true,
      )
    })

    it("should use peersWithDoc when searching for a document", () => {
      const [initialModel] = programInit(createPermissions())
      const modelWithPeerHavingDoc: Model = {
        ...initialModel,
        peers: new Set(["peer-1", "peer-2"]),
        peersWithDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
      }

      const message: Message = { type: "msg-sync-started", documentId: "doc-1" }
      const [newModel, command] = update(message, modelWithPeerHavingDoc)

      // Should request from peer-1 who has the doc, not peer-2 who only knows about it
      const syncState = newModel.syncStates.get("doc-1")
      expect(syncState?.state).toBe("syncing")
      expect((syncState as any).peerId).toBe("peer-1")

      const sendCommand = (command as any).commands.find(
        (c: any) => c.type === "cmd-send-message",
      )
      expect(sendCommand.message.targetIds).toEqual(["peer-1"])
    })
  })

  describe("Sync message forwarding with hop count", () => {
    it("should forward received sync messages to other aware peers with hop count", () => {
      const [initialModel] = programInit(createPermissions())
      const model: Model = {
        ...initialModel,
        peers: new Set(["peer-1", "peer-2", "peer-3"]),
        peersAwareOfDoc: new Map([
          ["doc-1", new Set(["peer-1", "peer-2", "peer-3"])],
        ]),
        localDocs: new Set(["doc-1"]),
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        data: syncData,
        hopCount: 0, // Original message
      }

      const [, command] = update(message, model)

      // Should have a batch command with sync-succeeded and forward message
      expect(command?.type).toBe("cmd-batch")
      const batchCommand = command as any
      expect(batchCommand.commands).toHaveLength(2)

      // First command should be sync-succeeded
      expect(batchCommand.commands[0]).toEqual({
        type: "cmd-sync-succeeded",
        documentId: "doc-1",
        data: syncData,
        requestId: undefined,
      })

      // Second command should forward to other peers with incremented hop count
      expect(batchCommand.commands[1]).toEqual({
        type: "cmd-send-message",
        message: {
          type: "sync",
          targetIds: ["peer-2", "peer-3"],
          documentId: "doc-1",
          data: syncData,
          hopCount: 1, // Incremented from 0
        },
      })
    })

    it("should NOT forward messages that have already been forwarded (hopCount >= 1)", () => {
      const [initialModel] = programInit(createPermissions())
      const model: Model = {
        ...initialModel,
        peers: new Set(["peer-1", "peer-2", "peer-3"]),
        peersAwareOfDoc: new Map([
          ["doc-1", new Set(["peer-1", "peer-2", "peer-3"])],
        ]),
        localDocs: new Set(["doc-1"]),
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        data: syncData,
        hopCount: 1, // Already forwarded once
      }

      const [, command] = update(message, model)

      // Should only apply the sync, not forward it
      expect(command?.type).toBe("cmd-sync-succeeded")
      expect((command as any).documentId).toBe("doc-1")
      expect((command as any).data).toEqual(syncData)
    })

    it("should treat missing hopCount as 0 (original message)", () => {
      const [initialModel] = programInit(createPermissions())
      const model: Model = {
        ...initialModel,
        peers: new Set(["peer-1", "peer-2"]),
        peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
        localDocs: new Set(["doc-1"]),
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        data: syncData,
        hopCount: 0, // Testing default behavior for original messages
      }

      const [, command] = update(message, model)

      // Should forward with hopCount: 1
      expect(command?.type).toBe("cmd-batch")
      const batchCommand = command as any
      expect(batchCommand.commands[1]).toEqual({
        type: "cmd-send-message",
        message: {
          type: "sync",
          targetIds: ["peer-2"],
          documentId: "doc-1",
          data: syncData,
          hopCount: 1,
        },
      })
    })

    it("should not forward if no other peers are aware", () => {
      const [initialModel] = programInit(createPermissions())
      const model: Model = {
        ...initialModel,
        peers: new Set(["peer-1"]),
        peersAwareOfDoc: new Map([
          ["doc-1", new Set(["peer-1"])], // Only the sender is aware
        ]),
        localDocs: new Set(["doc-1"]),
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        data: syncData,
        hopCount: 0,
      }

      const [, command] = update(message, model)

      // Should only have sync-succeeded, no forwarding
      expect(command?.type).toBe("cmd-sync-succeeded")
      expect((command as any).documentId).toBe("doc-1")
    })
  })

  describe("Cascade prevention scenarios", () => {
    it("should prevent cascade in hub-and-spoke topology", () => {
      // Scenario: Server receives sync from Browser A and forwards to Browser B
      // Browser B should NOT forward it back
      const [initialModel] = programInit(createPermissions())

      // Browser B's state
      const browserBModel: Model = {
        ...initialModel,
        peers: new Set(["server", "browser-a"]),
        peersAwareOfDoc: new Map([["doc-1", new Set(["server", "browser-a"])]]),
        localDocs: new Set(["doc-1"]),
      }

      // Message from server (already forwarded once)
      const syncData = new Uint8Array([1, 2, 3])
      const messageFromServer: Message = {
        type: "msg-received-sync",
        from: "server",
        documentId: "doc-1",
        data: syncData,
        hopCount: 1, // Server incremented this when forwarding
      }

      const [, command] = update(messageFromServer, browserBModel)

      // Browser B should only apply, not forward
      expect(command?.type).toBe("cmd-sync-succeeded")
      // No batch command with forwarding
      expect(command?.type).not.toBe("cmd-batch")
    })

    it("should allow single-hop forwarding in hub topology", () => {
      // Server receives original message and forwards once
      const [initialModel] = programInit(createPermissions())

      // Server's state
      const serverModel: Model = {
        ...initialModel,
        peers: new Set(["browser-a", "browser-b", "browser-c"]),
        peersAwareOfDoc: new Map([
          ["doc-1", new Set(["browser-a", "browser-b", "browser-c"])],
        ]),
        localDocs: new Set(["doc-1"]),
      }

      // Original message from browser-a
      const syncData = new Uint8Array([1, 2, 3])
      const originalMessage: Message = {
        type: "msg-received-sync",
        from: "browser-a",
        documentId: "doc-1",
        data: syncData,
        hopCount: 0, // Original message
      }

      const [, command] = update(originalMessage, serverModel)

      // Server should forward to other browsers
      expect(command?.type).toBe("cmd-batch")
      const batchCommand = command as any

      // Check forwarding command
      const forwardCommand = batchCommand.commands.find(
        (c: any) => c.type === "cmd-send-message",
      )
      expect(forwardCommand).toBeDefined()
      expect(forwardCommand.message.hopCount).toBe(1)
      expect(forwardCommand.message.targetIds).toEqual([
        "browser-b",
        "browser-c",
      ])
    })

    describe("Integration with Synchronizer class", () => {
      it("should properly pass hopCount from network message to internal message", () => {
        // This test would have caught the bug where synchronizer.ts wasn't passing hopCount
        const [initialModel] = programInit(createPermissions())
        const model: Model = {
          ...initialModel,
          peers: new Set(["peer-1", "peer-2"]),
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
          localDocs: new Set(["doc-1"]),
        }

        // Simulate a network message with hopCount
        const networkMessage: Message = {
          type: "msg-received-sync",
          from: "peer-1",
          documentId: "doc-1",
          data: new Uint8Array([1, 2, 3]),
          hopCount: 1, // This should prevent forwarding
        }

        const [, command] = update(networkMessage, model)

        // With hopCount=1, should NOT forward
        expect(command?.type).toBe("cmd-sync-succeeded")
        expect(command?.type).not.toBe("cmd-batch")
      })

      it("should include hopCount in outgoing sync messages for local changes", () => {
        const [initialModel] = programInit(createPermissions())
        const model: Model = {
          ...initialModel,
          peers: new Set(["peer-1"]),
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1"])]]),
          localDocs: new Set(["doc-1"]),
        }

        const message: Message = {
          type: "msg-local-change",
          documentId: "doc-1",
          data: new Uint8Array([1, 2, 3]),
        }

        const [, command] = update(message, model)

        expect(command?.type).toBe("cmd-send-message")
        const sendCommand = command as any
        expect(sendCommand.message.hopCount).toBe(0) // Should be 0 for original messages
      })
    })
  })
})
