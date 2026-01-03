/**
 * Tests for storage-first sync coordination.
 *
 * When a server has both network and storage adapters, network sync-requests
 * should wait for storage to be consulted before responding. This prevents
 * the race condition where clients receive "unavailable" before storage has
 * loaded the document.
 */

import { LoroDoc, type PeerID, VersionVector } from "loro-crdt"
import { beforeEach, describe, expect, it } from "vitest"
import type {
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
} from "../channel.js"
import {
  type Command,
  createSynchronizerUpdate,
  init,
  type SynchronizerModel,
} from "../synchronizer-program.js"
import type { ChannelId, DocId } from "../types.js"

describe("Storage-First Sync", () => {
  let model: SynchronizerModel
  let update: ReturnType<typeof createSynchronizerUpdate>
  let executeCommand: (cmd: Command | undefined) => void

  // Track sent messages for assertions
  const sentMessages: Array<{
    channelId: ChannelId
    message: ChannelMsgSyncRequest | ChannelMsgSyncResponse
  }> = []

  beforeEach(() => {
    sentMessages.length = 0

    // Initialize synchronizer with a valid numeric PeerID
    const [initialModel] = init({
      peerId: "9999999999" as PeerID,
      name: "server",
      type: "service",
    })
    model = initialModel

    update = createSynchronizerUpdate({
      permissions: {
        visibility: () => true,
        mutability: () => true,
        creation: () => true,
        deletion: () => true,
      },
    })

    // Simple command executor that tracks sent messages and imports data
    executeCommand = (cmd: Command | undefined) => {
      if (!cmd) return

      if (cmd.type === "cmd/batch") {
        for (const c of cmd.commands) {
          executeCommand(c)
        }
        return
      }

      if (cmd.type === "cmd/send-sync-request") {
        // Track the sync-request
        for (const doc of cmd.docs) {
          sentMessages.push({
            channelId: cmd.toChannelId,
            message: {
              type: "channel/sync-request",
              docId: doc.docId,
              requesterDocVersion: doc.requesterDocVersion,
              bidirectional: cmd.bidirectional,
            },
          })
        }
      }

      if (cmd.type === "cmd/send-sync-response") {
        sentMessages.push({
          channelId: cmd.toChannelId,
          message: {
            type: "channel/sync-response",
            docId: cmd.docId,
            transmission: { type: "unavailable" }, // Simplified for tracking
          },
        })
      }

      if (cmd.type === "cmd/send-message") {
        // Track messages sent via cmd/send-message
        for (const channelId of cmd.envelope.toChannelIds) {
          if (cmd.envelope.message.type === "channel/sync-request") {
            sentMessages.push({
              channelId,
              message: cmd.envelope.message,
            })
          }
        }
      }

      if (cmd.type === "cmd/import-doc-data") {
        // Actually import the data into the document
        const docState = model.documents.get(cmd.docId)
        if (docState) {
          docState.doc.import(cmd.data)
        }
      }
    }
  })

  /**
   * Helper to add a channel to the model and establish it
   */
  function addEstablishedChannel(
    kind: "network" | "storage",
    peerId: PeerID,
  ): ChannelId {
    const channelId = model.channels.size + 1

    // Add channel
    const [newModel1, cmd1] = update(
      {
        type: "synchronizer/channel-added",
        channel: {
          type: "connected",
          channelId,
          kind,
          adapterType: kind === "storage" ? "in-memory" : "websocket",
          send: () => {},
          stop: () => {},
          onReceive: () => {},
        },
      },
      model,
    )
    model = newModel1
    executeCommand(cmd1)

    // Establish channel
    const [newModel2, cmd2] = update(
      { type: "synchronizer/establish-channel", channelId },
      model,
    )
    model = newModel2
    executeCommand(cmd2)

    // Simulate establish-response
    const [newModel3, cmd3] = update(
      {
        type: "synchronizer/channel-receive-message",
        envelope: {
          fromChannelId: channelId,
          message: {
            type: "channel/establish-response",
            identity: { peerId, name: peerId, type: "service" },
          },
        },
      },
      model,
    )
    model = newModel3
    executeCommand(cmd3)

    return channelId
  }

  describe("when network request arrives for unknown doc with storage adapter", () => {
    it("should queue the network request and ask storage first", () => {
      // Setup: Add storage and network channels
      const storageChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )
      const networkChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )

      // Clear sent messages from setup
      sentMessages.length = 0

      // Act: Network client requests unknown document
      const [newModel, cmd] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: networkChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = newModel
      executeCommand(cmd)

      // Assert: Should have sent sync-request to storage, NOT to network
      const storageRequests = sentMessages.filter(
        m =>
          m.channelId === storageChannelId &&
          m.message.type === "channel/sync-request",
      )
      const networkResponses = sentMessages.filter(
        m =>
          m.channelId === networkChannelId &&
          m.message.type === "channel/sync-response",
      )

      expect(storageRequests).toHaveLength(1)
      expect(networkResponses).toHaveLength(0) // No response to network yet!

      // Assert: Document should have pending state
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState).toBeDefined()
      expect(docState?.pendingStorageChannels?.size).toBe(1)
      expect(docState?.pendingStorageChannels?.has(storageChannelId)).toBe(true)
      expect(docState?.pendingNetworkRequests).toHaveLength(1)
      expect(docState?.pendingNetworkRequests?.[0].channelId).toBe(
        networkChannelId,
      )
    })

    it("should respond to network after storage responds with data", () => {
      // Setup: Add storage and network channels
      const storageChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )
      const networkChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )

      // Network client requests unknown document
      const [model1, cmd1] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: networkChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = model1
      executeCommand(cmd1)

      // Clear sent messages
      sentMessages.length = 0

      // Act: Storage responds with data
      const testDoc = new LoroDoc()
      testDoc.getText("content").insert(0, "Hello from storage!")
      const data = testDoc.export({ mode: "snapshot" })

      const [model2, cmd2] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storageChannelId,
            message: {
              type: "channel/sync-response",
              docId: "doc-123" as DocId,
              transmission: {
                type: "snapshot",
                data,
                version: testDoc.oplogVersion(),
              },
            },
          },
        },
        model,
      )
      model = model2
      executeCommand(cmd2)

      // Assert: Should have sent sync-response to network
      const networkResponses = sentMessages.filter(
        m =>
          m.channelId === networkChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(networkResponses).toHaveLength(1)

      // Assert: Pending state should be cleared
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels).toBeUndefined()
      expect(docState?.pendingNetworkRequests).toHaveLength(0)
    })

    it("should respond to network after storage responds with unavailable", () => {
      // Setup: Add storage and network channels
      const storageChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )
      const networkChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )

      // Network client requests unknown document
      const [model1, cmd1] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: networkChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = model1
      executeCommand(cmd1)

      // Clear sent messages
      sentMessages.length = 0

      // Act: Storage responds with unavailable
      const [model2, cmd2] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storageChannelId,
            message: {
              type: "channel/sync-response",
              docId: "doc-123" as DocId,
              transmission: { type: "unavailable" },
            },
          },
        },
        model,
      )
      model = model2
      executeCommand(cmd2)

      // Assert: Should have sent sync-response to network
      const networkResponses = sentMessages.filter(
        m =>
          m.channelId === networkChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(networkResponses).toHaveLength(1)

      // Assert: Pending state should be cleared
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels).toBeUndefined()
      expect(docState?.pendingNetworkRequests).toHaveLength(0)
    })
  })

  describe("when network request arrives for unknown doc without storage adapter", () => {
    it("should respond immediately with unavailable", () => {
      // Setup: Add only network channel (no storage)
      const networkChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )

      // Clear sent messages from setup
      sentMessages.length = 0

      // Act: Network client requests unknown document
      const [newModel, cmd] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: networkChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = newModel
      executeCommand(cmd)

      // Assert: Should have sent sync-response immediately
      const networkResponses = sentMessages.filter(
        m =>
          m.channelId === networkChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(networkResponses).toHaveLength(1)

      // Assert: No pending state
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels).toBeUndefined()
      expect(docState?.pendingNetworkRequests).toBeUndefined()
    })
  })

  describe("when storage request arrives for unknown doc", () => {
    it("should respond immediately without pending state for non-bidirectional storage request", () => {
      // Setup: Add storage channel
      const storageChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )

      // Clear sent messages from setup
      sentMessages.length = 0

      // Act: Storage requests unknown document with bidirectional=false
      // This is a simple request, not an announcement
      const [newModel, cmd] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storageChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: false,
            },
          },
        },
        model,
      )
      model = newModel
      executeCommand(cmd)

      // Assert: Should have sent sync-response immediately
      const storageResponses = sentMessages.filter(
        m =>
          m.channelId === storageChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(storageResponses).toHaveLength(1)

      // Assert: No pending state (non-bidirectional doesn't set pending)
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels).toBeUndefined()
      expect(docState?.pendingNetworkRequests).toBeUndefined()
    })
  })

  describe("with multiple storage adapters", () => {
    it("should wait for all storage adapters before responding to network", () => {
      // Setup: Add two storage channels and one network channel
      const storage1ChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )
      const storage2ChannelId = addEstablishedChannel(
        "storage",
        "storage-2" as PeerID,
      )
      const networkChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )

      // Network client requests unknown document
      const [model1, cmd1] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: networkChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = model1
      executeCommand(cmd1)

      // Assert: Should be waiting for both storage adapters
      let docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels?.size).toBe(2)

      // Clear sent messages
      sentMessages.length = 0

      // First storage responds with unavailable
      const [model2, cmd2] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storage1ChannelId,
            message: {
              type: "channel/sync-response",
              docId: "doc-123" as DocId,
              transmission: { type: "unavailable" },
            },
          },
        },
        model,
      )
      model = model2
      executeCommand(cmd2)

      // Assert: Still waiting for second storage, no network response yet
      docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels?.size).toBe(1)
      expect(
        sentMessages.filter(
          m =>
            m.channelId === networkChannelId &&
            m.message.type === "channel/sync-response",
        ),
      ).toHaveLength(0)

      // Second storage responds with data
      const testDoc = new LoroDoc()
      testDoc.getText("content").insert(0, "Hello from storage 2!")
      const data = testDoc.export({ mode: "snapshot" })

      const [model3, cmd3] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storage2ChannelId,
            message: {
              type: "channel/sync-response",
              docId: "doc-123" as DocId,
              transmission: {
                type: "snapshot",
                data,
                version: testDoc.oplogVersion(),
              },
            },
          },
        },
        model,
      )
      model = model3
      executeCommand(cmd3)

      // Assert: Now should have responded to network
      const networkResponses = sentMessages.filter(
        m =>
          m.channelId === networkChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(networkResponses).toHaveLength(1)

      // Assert: Pending state should be cleared
      docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingStorageChannels).toBeUndefined()
    })
  })

  describe("when multiple network requests arrive while waiting for storage", () => {
    it("should queue all requests and respond to all when storage responds", () => {
      // Setup: Add storage and two network channels
      const storageChannelId = addEstablishedChannel(
        "storage",
        "storage-1" as PeerID,
      )
      const network1ChannelId = addEstablishedChannel(
        "network",
        "client-1" as PeerID,
      )
      const network2ChannelId = addEstablishedChannel(
        "network",
        "client-2" as PeerID,
      )

      // First network client requests document
      const [model1, cmd1] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: network1ChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = model1
      executeCommand(cmd1)

      // Second network client requests same document
      const [model2, cmd2] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: network2ChannelId,
            message: {
              type: "channel/sync-request",
              docId: "doc-123" as DocId,
              requesterDocVersion: new VersionVector(null),
              bidirectional: true,
            },
          },
        },
        model,
      )
      model = model2
      executeCommand(cmd2)

      // Assert: Both requests should be queued
      const docState = model.documents.get("doc-123" as DocId)
      expect(docState?.pendingNetworkRequests).toHaveLength(2)

      // Clear sent messages
      sentMessages.length = 0

      // Storage responds
      const [model3, cmd3] = update(
        {
          type: "synchronizer/channel-receive-message",
          envelope: {
            fromChannelId: storageChannelId,
            message: {
              type: "channel/sync-response",
              docId: "doc-123" as DocId,
              transmission: { type: "unavailable" },
            },
          },
        },
        model,
      )
      model = model3
      executeCommand(cmd3)

      // Assert: Should have responded to both network clients
      const network1Responses = sentMessages.filter(
        m =>
          m.channelId === network1ChannelId &&
          m.message.type === "channel/sync-response",
      )
      const network2Responses = sentMessages.filter(
        m =>
          m.channelId === network2ChannelId &&
          m.message.type === "channel/sync-response",
      )
      expect(network1Responses).toHaveLength(1)
      expect(network2Responses).toHaveLength(1)
    })
  })
})
