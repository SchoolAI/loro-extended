/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPeersAwareOfDocument,
  getPeersWithDocument,
  isPeerAwareOfDocument,
} from "./document-peer-registry.js"
import type { PeerMetadata } from "./network/network-adapter.js"
import { createPermissions } from "./permission-adapter.js"
import {
  type Message,
  type Model,
  init as programInit,
  update,
} from "./synchronizer-program.js"

describe("Synchronizer program", () => {
  beforeEach(() => {
    // No services needed anymore
  })

  describe("initialization", () => {
    it("should initialize correctly", () => {
      const [model, command] = programInit(createPermissions())
      expect(model.localDocs.size).toBe(0)
      expect(model.syncStates.size).toBe(0)
      expect(command).toBeUndefined()
    })
  })

  describe("peer management", () => {
    it("should announce local documents when a peer is added", () => {
      const [initialModel] = programInit(createPermissions())
      const documentId = "doc-1"
      const modelWithDoc: Model = {
        ...initialModel,
        localDocs: new Set([documentId]),
      }

      const message: Message = { type: "msg-peer-added", peerId: "peer-1" }
      const [newModel, command] = update(message, modelWithDoc)

      expect(command).toEqual({
        type: "cmd-send-message",
        message: {
          type: "directory-response",
          documentIds: [documentId],
          targetIds: ["peer-1"],
        },
      })

      // Verify that the peer was added to the model's remoteDocs
      expect(newModel.remoteDocs.peersAwareOfDoc.get(documentId)).toContain(
        "peer-1",
      )
    })

    it("should remove a peer from the model when disconnected", () => {
      const [initialModel] = programInit(createPermissions())

      // First add a peer to have something to remove
      const modelWithPeer: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersWithDoc: new Map([["doc-1", new Set(["peer-1"])]]),
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        },
      }

      const message: Message = { type: "msg-peer-removed", peerId: "peer-1" }
      const [newModel, command] = update(message, modelWithPeer)

      expect(command).toBeUndefined()

      // Verify that the peer was removed from the model's remoteDocs
      const peersWithDoc = newModel.remoteDocs.peersWithDoc.get("doc-1")
      const peersAwareOfDoc = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")

      expect(peersWithDoc?.has("peer-1") ?? false).toBe(false)
      expect(peersAwareOfDoc?.has("peer-1") ?? false).toBe(false)
    })
  })

  describe("document management", () => {
    it("should announce a new document to connected peers", () => {
      // Mock permissions to allow listing for all peers
      const permissions = createPermissions({
        canList: vi.fn().mockReturnValue(true),
      })

      const [initialModel] = programInit(permissions)
      const documentId = "doc-1"

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
      }

      const message: Message = { type: "msg-document-added", documentId }
      const [, command] = update(message, modelWithPeers)

      expect(command).toEqual({
        type: "cmd-send-message",
        message: {
          type: "directory-response",
          documentIds: [documentId],
          targetIds: ["peer-1", "peer-2"],
        },
      })
    })

    it("should not announce a new document to peers if canList returns false", () => {
      const [initialModel] = programInit(
        createPermissions({
          canList: (peerId, documentId) => {
            if (peerId === "peer-2" && documentId === "doc-1") return false
            return true
          },
        }),
      )

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
      }

      const message: Message = {
        type: "msg-document-added",
        documentId: "doc-1",
      }
      const [, command] = update(message, modelWithPeers)

      expect((command as any).message.targetIds).toEqual(["peer-1"])
    })

    it("should inform peers when a document is deleted", () => {
      const [initialModel] = programInit(createPermissions())
      const documentId = "doc-1"

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
      }

      const message: Message = { type: "msg-document-removed", documentId }
      const [, command] = update(message, modelWithPeers)

      expect(command).toEqual({
        type: "cmd-send-message",
        message: {
          type: "delete-response",
          status: "deleted",
          documentId,
          targetIds: ["peer-1", "peer-2"],
        },
      })
    })
  })

  describe("synchronization", () => {
    it("should start syncing when a document is requested", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([["peer-1", {} as PeerMetadata]]),
      }

      const message: Message = { type: "msg-sync-started", documentId: "doc-1" }
      const [newModel, command] = update(message, modelWithPeers)

      const syncState = newModel.syncStates.get("doc-1")
      expect(syncState?.state).toBe("searching")

      expect(command).toEqual({
        type: "cmd-batch",
        commands: [
          {
            type: "cmd-send-message",
            message: {
              type: "sync-request",
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
              type: "sync-request",
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
        syncStates: new Map([
          ["doc-1", { state: "syncing", peerId: "peer-1" }],
        ]),
      }

      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        transmission: {
          type: "update",
          data: new Uint8Array([1, 2, 3]),
        },
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
            transmission: { type: "update", data: new Uint8Array([1, 2, 3]) },
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
        transmission: { type: "update", data: new Uint8Array([1, 2, 3]) },
        hopCount: 0, // Original message
      }

      const [newModel, command] = update(message, modelWithSyncState)

      expect(newModel.syncStates.has("doc-1")).toBe(true)
      expect(command).toBeUndefined()
    })

    it("should send a sync message to peers aware of document on local change", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
        },
      }

      const message: Message = {
        type: "msg-local-change",
        documentId: "doc-1",
        data: new Uint8Array([1, 2, 3]),
      }

      const [, command] = update(message, modelWithAwarePeers)

      expect((command as any).message.targetIds).toEqual(["peer-1", "peer-2"])
      expect((command as any).message.transmission.data).toEqual(
        new Uint8Array([1, 2, 3]),
      )
    })
  })

  describe("document announcement handling", () => {
    it("should track peer document ownership when announcement is received", () => {
      const [initialModel] = programInit(createPermissions())
      const documentIds = ["doc-1", "doc-2"]

      const message: Message = {
        type: "msg-received-doc-announced",
        from: "peer-1",
        documentIds,
      }

      const [newModel, _command] = update(message, initialModel)

      // Verify that the peer was recorded as having these documents
      for (const documentId of documentIds) {
        expect(newModel.remoteDocs.peersWithDoc.get(documentId)).toContain(
          "peer-1",
        )
        expect(newModel.remoteDocs.peersAwareOfDoc.get(documentId)).toContain(
          "peer-1",
        )
      }
    })

    it("should notify about newly discovered documents", () => {
      const [initialModel] = programInit(createPermissions())
      const documentIds = ["doc-1", "doc-2"]

      const message: Message = {
        type: "msg-received-doc-announced",
        from: "peer-1",
        documentIds,
      }

      const [, command] = update(message, initialModel)

      // Should notify about newly discovered documents
      expect(command).toEqual({
        type: "cmd-notify-docs-available",
        documentIds,
      })
    })

    it("should request sync from peers that have documents we're searching for", () => {
      const [initialModel] = programInit(createPermissions())
      const modelWithSyncState: Model = {
        ...initialModel,
        syncStates: new Map([["doc-1", { state: "searching" }]]),
      }

      const message: Message = {
        type: "msg-received-doc-announced",
        from: "peer-1",
        documentIds: ["doc-1"],
      }

      const [newModel, command] = update(message, modelWithSyncState)

      // Should transition to syncing state
      const syncState = newModel.syncStates.get("doc-1")
      expect(syncState?.state).toBe("syncing")
      expect((syncState as any).peerId).toBe("peer-1")

      // Should send a request to the peer that has the document
      expect(command).toEqual({
        type: "cmd-batch",
        commands: [
          { type: "cmd-clear-timeout", documentId: "doc-1" },
          {
            type: "cmd-send-message",
            message: {
              type: "sync-request",
              documentId: "doc-1",
              targetIds: ["peer-1"],
            },
          },
          { type: "cmd-set-timeout", documentId: "doc-1", duration: 5000 },
        ],
      })
    })
  })

  describe("document request handling", () => {
    it("should track peer awareness when a document is requested", () => {
      const [initialModel] = programInit(createPermissions())

      const message: Message = {
        type: "msg-received-doc-request",
        from: "peer-1",
        documentId: "doc-1",
      }

      const [newModel, command] = update(message, initialModel)

      // Verify that the peer was recorded as being aware of the document
      expect(newModel.remoteDocs.peersAwareOfDoc.get("doc-1")).toContain(
        "peer-1",
      )

      // Should check storage and respond
      expect(command).toEqual({
        type: "cmd-check-storage-and-respond",
        documentId: "doc-1",
        to: "peer-1",
      })
    })
  })

  describe("sync message forwarding with hop count", () => {
    it("should forward received sync messages to other peers aware of document with hop count", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([
            ["doc-1", new Set(["peer-1", "peer-2", "peer-3"])],
          ]),
        },
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        hopCount: 0, // Original message
      }

      const [, command] = update(message, modelWithAwarePeers)

      // Should have a batch command with sync-succeeded and forward message
      expect(command?.type).toBe("cmd-batch")
      const batchCommand = command as any
      expect(batchCommand.commands).toHaveLength(2)

      // First command should be sync-succeeded
      expect(batchCommand.commands[0]).toEqual({
        type: "cmd-sync-succeeded",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        requestId: undefined,
      })

      // Second command should forward to other peers with incremented hop count
      expect(batchCommand.commands[1]).toEqual({
        type: "cmd-send-message",
        message: {
          type: "sync-response",
          targetIds: ["peer-2", "peer-3"],
          documentId: "doc-1",
          transmission: { type: "update", data: syncData },
          hopCount: 1, // Incremented from 0
        },
      })
    })

    it("should NOT forward messages that have already been forwarded (hopCount >= 1)", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([
            ["doc-1", new Set(["peer-1", "peer-2", "peer-3"])],
          ]),
        },
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        hopCount: 1, // Already forwarded once
      }

      const [, command] = update(message, modelWithAwarePeers)

      // Should only apply the sync, not forward it
      expect(command?.type).toBe("cmd-sync-succeeded")

      // Use type assertion with expect for better type safety and error messages
      expect(command).toBeDefined()
      expect(command).toEqual(
        expect.objectContaining({
          type: "cmd-sync-succeeded",
          documentId: "doc-1",
          transmission: expect.objectContaining({
            type: "update",
            data: syncData,
          }),
        }),
      )
    })

    it("should not forward if no other peers are aware", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with only the sender as aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([
            ["doc-1", new Set(["peer-1"])], // Only the sender is aware
          ]),
        },
      }

      const syncData = new Uint8Array([1, 2, 3])
      const message: Message = {
        type: "msg-received-sync",
        from: "peer-1",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        hopCount: 0,
      }

      const [, command] = update(message, modelWithAwarePeers)

      // Should only have sync-succeeded, no forwarding
      expect(command?.type).toBe("cmd-sync-succeeded")
      expect((command as any).documentId).toBe("doc-1")
    })
  })

  describe("cascade prevention scenarios", () => {
    it("should prevent cascade in hub-and-spoke topology", () => {
      // Scenario: Server receives sync from Browser A and forwards to Browser B
      // Browser B should NOT forward it back
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([
            ["doc-1", new Set(["server", "browser-a"])],
          ]),
        },
      }

      // Message from server (already forwarded once)
      const syncData = new Uint8Array([1, 2, 3])
      const messageFromServer: Message = {
        type: "msg-received-sync",
        from: "server",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        hopCount: 1, // Server incremented this when forwarding
      }

      const [, command] = update(messageFromServer, modelWithAwarePeers)

      // Browser B should only apply, not forward
      expect(command?.type).toBe("cmd-sync-succeeded")
      // No batch command with forwarding
      expect(command?.type).not.toBe("cmd-batch")
    })

    it("should allow single-hop forwarding in hub topology", () => {
      // Server receives original message and forwards once
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of the document
      const modelWithAwarePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([
            ["doc-1", new Set(["browser-a", "browser-b", "browser-c"])],
          ]),
        },
      }

      // Original message from browser-a
      const syncData = new Uint8Array([1, 2, 3])
      const originalMessage: Message = {
        type: "msg-received-sync",
        from: "browser-a",
        documentId: "doc-1",
        transmission: { type: "update", data: syncData },
        hopCount: 0, // Original message
      }

      const [, command] = update(originalMessage, modelWithAwarePeers)

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
  })
})

describe("Peer Management Integration", () => {
  describe("peer connectivity in model", () => {
    it("should track connected peers in model state", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
      }

      // Check that peers are tracked in the model
      expect(modelWithPeers.peers.size).toBe(2)
      expect(modelWithPeers.peers.has("peer-1")).toBe(true)
      expect(modelWithPeers.peers.has("peer-2")).toBe(true)
    })

    it("should handle peer disconnection in model state", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with connected peers
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
      }

      // Remove a peer
      const modelAfterDisconnect: Model = {
        ...modelWithPeers,
        peers: new Map([
          ["peer-2", {} as PeerMetadata], // Only peer-2 remains
        ]),
      }

      // Check that peer was removed
      expect(modelAfterDisconnect.peers.size).toBe(1)
      expect(modelAfterDisconnect.peers.has("peer-1")).toBe(false)
      expect(modelAfterDisconnect.peers.has("peer-2")).toBe(true)
    })

    it("should handle peer metadata", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers that have metadata
      const modelWithPeers: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", { networkAdapter: "adapter1" } as PeerMetadata],
          ["peer-2", { networkAdapter: "adapter2" } as PeerMetadata],
        ]),
      }

      // Check that metadata is preserved
      expect(modelWithPeers.peers.get("peer-1")?.networkAdapter).toBe(
        "adapter1",
      )
      expect(modelWithPeers.peers.get("peer-2")?.networkAdapter).toBe(
        "adapter2",
      )
    })
  })

  describe("peer and document interactions", () => {
    it("should announce documents to connected peers", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers and documents
      const modelWithPeersAndDocs: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
        localDocs: new Set(["doc-1"]),
      }

      // Add a new document
      const message: Message = {
        type: "msg-document-added",
        documentId: "doc-2",
      }
      const [, command] = update(message, modelWithPeersAndDocs)

      // Should announce to both peers
      expect(command?.type).toBe("cmd-send-message")
      expect((command as any).message.targetIds).toEqual(["peer-1", "peer-2"])
    })

    it("should handle peer removal with document cleanup", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers and document relationships
      const modelWithRelationships: Model = {
        ...initialModel,
        peers: new Map([
          ["peer-1", {} as PeerMetadata],
          ["peer-2", {} as PeerMetadata],
        ]),
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
          peersWithDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        },
      }

      // Remove peer-1
      const message: Message = { type: "msg-peer-removed", peerId: "peer-1" }
      const [newModel] = update(message, modelWithRelationships)

      // Check that peer-1 was removed from document relationships
      const awarePeers = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")
      const withDocPeers = newModel.remoteDocs.peersWithDoc.get("doc-1")

      expect(awarePeers?.has("peer-1")).toBe(false)
      expect(awarePeers?.has("peer-2")).toBe(true)
      expect(withDocPeers?.has("peer-1") ?? false).toBe(false)
    })
  })
})

describe("DocumentPeerRegistry Integration", () => {
  describe("peer document ownership in model", () => {
    it("should track peers that have documents in model.remoteDocs", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers that have documents
      const modelWithDocOwnership: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersWithDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        },
      }

      // Check that peers with documents are tracked
      const peersWithDoc =
        modelWithDocOwnership.remoteDocs.peersWithDoc.get("doc-1")
      expect(peersWithDoc).toContain("peer-1")
      expect(
        getPeersWithDocument(modelWithDocOwnership.remoteDocs, "doc-1"),
      ).toEqual(["peer-1"])
    })

    it("should track peers that are aware of documents in model.remoteDocs", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peers aware of documents
      const modelWithDocAwareness: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        },
      }

      // Check that peers aware of documents are tracked
      const peersAwareOfDoc =
        modelWithDocAwareness.remoteDocs.peersAwareOfDoc.get("doc-1")
      expect(peersAwareOfDoc).toContain("peer-1")
      expect(
        getPeersAwareOfDocument(modelWithDocAwareness.remoteDocs, "doc-1"),
      ).toEqual(["peer-1"])
    })

    it("should handle multiple peers with documents", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with multiple peers that have documents
      const modelWithMultiplePeers: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersWithDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
        },
      }

      // Check that all peers are tracked
      const peersWithDoc =
        modelWithMultiplePeers.remoteDocs.peersWithDoc.get("doc-1")
      expect(peersWithDoc).toContain("peer-1")
      expect(peersWithDoc).toContain("peer-2")
      expect(
        getPeersWithDocument(modelWithMultiplePeers.remoteDocs, "doc-1"),
      ).toEqual(["peer-1", "peer-2"])
    })

    it("should handle multiple documents", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with multiple documents
      const modelWithMultipleDocs: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersWithDoc: new Map([
            ["doc-1", new Set(["peer-1"])],
            ["doc-2", new Set(["peer-1", "peer-2"])],
          ]),
        },
      }

      // Check that all documents are tracked correctly
      expect(
        getPeersWithDocument(modelWithMultipleDocs.remoteDocs, "doc-1"),
      ).toEqual(["peer-1"])
      expect(
        getPeersWithDocument(modelWithMultipleDocs.remoteDocs, "doc-2"),
      ).toEqual(["peer-1", "peer-2"])
    })

    it("should handle empty document relationships", () => {
      const [initialModel] = programInit(createPermissions())

      // Check that empty relationships are handled correctly
      expect(getPeersWithDocument(initialModel.remoteDocs, "doc-1")).toEqual([])
      expect(getPeersAwareOfDocument(initialModel.remoteDocs, "doc-1")).toEqual(
        [],
      )
    })
  })

  describe("document registry updates through messages", () => {
    it("should update document registry when peer is added", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with local documents
      const modelWithDocs: Model = {
        ...initialModel,
        localDocs: new Set(["doc-1"]),
      }

      // Add a peer
      const message: Message = { type: "msg-peer-added", peerId: "peer-1" }
      const [newModel] = update(message, modelWithDocs)

      // Check that peer is now aware of the document
      const awarePeers = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")
      expect(awarePeers).toContain("peer-1")
    })

    it("should update document registry when document is announced", () => {
      const [initialModel] = programInit(createPermissions())

      // Receive document announcement
      const message: Message = {
        type: "msg-received-doc-announced",
        from: "peer-1",
        documentIds: ["doc-1"],
      }
      const [newModel] = update(message, initialModel)

      // Check that peer is recorded as having and being aware of the document
      const peersWithDoc = newModel.remoteDocs.peersWithDoc.get("doc-1")
      const peersAwareOfDoc = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")

      expect(peersWithDoc).toContain("peer-1")
      expect(peersAwareOfDoc).toContain("peer-1")
    })

    it("should update document registry when document is requested", () => {
      const [initialModel] = programInit(createPermissions())

      // Receive document request
      const message: Message = {
        type: "msg-received-doc-request",
        from: "peer-1",
        documentId: "doc-1",
      }
      const [newModel] = update(message, initialModel)

      // Check that peer is recorded as being aware of the document
      const peersAwareOfDoc = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")
      expect(peersAwareOfDoc).toContain("peer-1")
    })

    it("should update document registry when peer is removed", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peer relationships
      const modelWithRelationships: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersWithDoc: new Map([["doc-1", new Set(["peer-1"])]]),
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1", "peer-2"])]]),
        },
      }

      // Remove peer-1
      const message: Message = { type: "msg-peer-removed", peerId: "peer-1" }
      const [newModel] = update(message, modelWithRelationships)

      // Check that peer-1 was removed from all relationships
      const peersWithDoc = newModel.remoteDocs.peersWithDoc.get("doc-1")
      const peersAwareOfDoc = newModel.remoteDocs.peersAwareOfDoc.get("doc-1")

      expect(peersWithDoc?.has("peer-1") ?? false).toBe(false)
      expect(peersAwareOfDoc?.has("peer-1")).toBe(false)
      expect(peersAwareOfDoc?.has("peer-2")).toBe(true)
    })
  })

  describe("helper functions", () => {
    it("should check if peer is aware of document", () => {
      const [initialModel] = programInit(createPermissions())

      // Create a model with peer awareness
      const modelWithAwareness: Model = {
        ...initialModel,
        remoteDocs: {
          ...initialModel.remoteDocs,
          peersAwareOfDoc: new Map([["doc-1", new Set(["peer-1"])]]),
        },
      }

      // Check awareness
      expect(
        isPeerAwareOfDocument(modelWithAwareness.remoteDocs, "peer-1", "doc-1"),
      ).toBe(true)
      expect(
        isPeerAwareOfDocument(modelWithAwareness.remoteDocs, "peer-2", "doc-1"),
      ).toBe(false)
    })
  })
})
