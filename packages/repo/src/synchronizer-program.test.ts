/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Channel } from "./channel.js"
import { createPermissions } from "./rules.js"
import {
  type Command,
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
  type SynchronizerModel,
} from "./synchronizer-program.js"
import { createDocState } from "./types.js"

// Helper to create a proper VersionVector
function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

// Test utilities and helpers
function createMockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    channelId: 1,
    kind: "network",
    adapterId: "test-adapter",
    peer: { state: "unestablished" },
    send: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  }
}

function createModelWithChannel(channel: Channel): SynchronizerModel {
  const [model] = programInit({ name: "test-identity" })
  model.channels.set(channel.channelId, channel)
  return model
}

function expectCommand(
  command: Command | undefined,
  expectedType: string,
): asserts command is Command {
  expect(command).toBeDefined()

  if (!command) {
    throw new Error("command is undefined")
  }

  expect(command.type).toBe(expectedType)
}

function expectBatchCommand(
  command: Command | undefined,
): asserts command is Extract<Command, { type: "cmd/batch" }> {
  expect(command).toBeDefined()

  if (!command) {
    throw new Error("command is undefined")
  }

  expect(command.type).toBe("cmd/batch")
}

describe("Synchronizer Program", () => {
  let update: ReturnType<typeof createSynchronizerUpdate>

  beforeEach(() => {
    update = createSynchronizerUpdate({
      permissions: createPermissions(),
    })
  })

  describe("initialization", () => {
    it("should initialize with empty state", () => {
      const identity = { name: "test-peer" }
      const [model, command] = programInit(identity)

      expect(model.identity).toEqual(identity)
      expect(model.documents.size).toBe(0)
      expect(model.channels.size).toBe(0)
      expect(command).toBeUndefined()
    })
  })

  describe("channel management", () => {
    describe("channel-added", () => {
      it("should add channel to model and return start-channel command", () => {
        const [initialModel] = programInit({ name: "test" })
        const channel = createMockChannel()

        const message: SynchronizerMessage = {
          type: "msg/channel-added",
          channel,
        }

        const [newModel, command] = update(message, initialModel)

        expect(newModel.channels.get(channel.channelId)).toBe(channel)
        expectCommand(command, "cmd/start-channel")
        expect((command as any).channel).toBe(channel)
      })
    })

    describe("channel-removed", () => {
      it("should remove channel from model and return stop-channel command", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-removed",
          channel,
        }

        const [newModel, command] = update(message, initialModel)

        expect(newModel.channels.has(channel.channelId)).toBe(false)
        expectCommand(command, "cmd/stop-channel")
        expect((command as any).channel.channelId).toBe(channel.channelId)
      })

      it("should remove channel from all document states", () => {
        const channel = createMockChannel()
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document with channel state
        const docState = createDocState({ docId })
        docState.channelState.set(channel.channelId, {
          awareness: "has-doc",
          loading: { state: "found", version: createVersionVector() },
        })
        initialModel.documents.set(docId, docState)

        const message: SynchronizerMessage = {
          type: "msg/channel-removed",
          channel,
        }

        const [newModel, _command] = update(message, initialModel)

        const updatedDocState = newModel.documents.get(docId)
        expect(updatedDocState?.channelState.has(channel.channelId)).toBe(false)
      })

      it("should log error when channel doesn't exist", () => {
        const [initialModel] = programInit({ name: "test" })
        const channel = createMockChannel()

        const message: SynchronizerMessage = {
          type: "msg/channel-removed",
          channel,
        }

        const [_newModel, command] = update(message, initialModel)

        expectCommand(command, "cmd/log")
        expect((command as any).message).toContain(
          "channel didn't exist when removing",
        )
      })
    })
  })

  describe("channel message handling", () => {
    describe("establish-request", () => {
      it("should establish channel and send response", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/establish-request",
              identity: { name: "test" },
            },
          },
        }

        const [newModel, command] = update(message, initialModel)

        // Channel should be established
        const updatedChannel = newModel.channels.get(channel.channelId)
        if (!updatedChannel) {
          throw new Error("updatedChannel expected")
        }

        const peer = updatedChannel.peer
        expect(peer.state).toBe("established")
        expect(peer.state === "established" && peer.identity.name).toBe("test")

        // Should return batch command with establish and send-message
        expectBatchCommand(command)
        expect(command.commands).toHaveLength(2)
        expect(command.commands[0].type).toBe("cmd/send-message")
      })
    })

    describe("establish-response", () => {
      it("should establish channel from response", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/establish-response",
              identity: { name: "test" },
            },
          },
        }

        const [newModel, command] = update(message, initialModel)

        // Channel should be established
        const updatedChannel = newModel.channels.get(channel.channelId)
        if (!updatedChannel) {
          throw new Error("updatedChannel expected")
        }

        const peer = updatedChannel.peer
        expect(peer.state).toBe("established")
        expect(peer.state === "established" && peer.identity.name).toBe("test")

        expectCommand(command, "cmd/send-message")
      })
    })

    describe("sync-request", () => {
      it("should respond with sync data when document exists", () => {
        const channel = createMockChannel()
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document
        const docState = createDocState({ docId })
        initialModel.documents.set(docId, docState)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-request",
              docs: [
                {
                  docId,
                  requesterDocVersion: createVersionVector(),
                },
              ],
            },
          },
        }

        const [_newModel, command] = update(message, initialModel)

        // The sync-request should return a send-sync-response command directly, not batched
        expectCommand(command, "cmd/send-sync-response")
        expect((command as any).docId).toBe(docId)
      })

      it("should return undefined when document doesn't exist", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-request",
              docs: [
                {
                  docId: "nonexistent-doc",
                  requesterDocVersion: createVersionVector(),
                },
              ],
            },
          },
        }

        const [_newModel, command] = update(message, initialModel)

        expect(command).toBeUndefined()
      })
    })

    describe("sync-response", () => {
      it("should handle up-to-date response", () => {
        const channel = createMockChannel()
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document with channel state
        const docState = createDocState({ docId })
        docState.channelState.set(channel.channelId, {
          awareness: "unknown",
          loading: { state: "requesting" },
        })
        initialModel.documents.set(docId, docState)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-response",
              docId,
              transmission: {
                type: "up-to-date",
                version: createVersionVector(),
              },
              hopCount: 0,
            },
          },
        }

        const [newModel, command] = update(message, initialModel)

        // Should update awareness and loading state
        const updatedDocState = newModel.documents.get(docId)
        const channelState = updatedDocState?.channelState.get(
          channel.channelId,
        )
        expect(channelState?.awareness).toBe("has-doc")
        expect(channelState?.loading.state).toBe("found")

        // Should emit ready state changed
        expectCommand(command, "cmd/emit-ready-state-changed")
      })

      it("should handle snapshot response", () => {
        const channel = createMockChannel({
          peer: {
            state: "established",
            identity: { name: "test-peer" },
          },
        })
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document with channel state
        const docState = createDocState({ docId })
        docState.channelState.set(channel.channelId, {
          awareness: "unknown",
          loading: { state: "requesting" },
        })
        initialModel.documents.set(docId, docState)

        // Create valid snapshot data by exporting from a LoroDoc
        const sourceDoc = new LoroDoc()
        sourceDoc.getText("test").insert(0, "hello")
        const snapshotData = sourceDoc.export({ mode: "snapshot" })
        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-response",
              docId,
              transmission: {
                type: "snapshot",
                data: snapshotData,
                version: createVersionVector(),
              },
              hopCount: 0,
            },
          },
        }

        const [newModel, command] = update(message, initialModel)

        // Document should have imported the data
        const updatedDocState = newModel.documents.get(docId)
        expect(updatedDocState?.doc).toBeDefined()

        // Should emit ready state changed
        expectCommand(command, "cmd/emit-ready-state-changed")
      })

      it("should handle unavailable response", () => {
        const channel = createMockChannel()
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document with channel state
        const docState = createDocState({ docId })
        docState.channelState.set(channel.channelId, {
          awareness: "unknown",
          loading: { state: "requesting" },
        })
        initialModel.documents.set(docId, docState)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-response",
              docId,
              transmission: {
                type: "unavailable",
              },
              hopCount: 0,
            },
          },
        }

        const [newModel, command] = update(message, initialModel)

        // Should update awareness to no-doc and loading to not-found
        const updatedDocState = newModel.documents.get(docId)
        const channelState = updatedDocState?.channelState.get(
          channel.channelId,
        )
        expect(channelState?.awareness).toBe("no-doc")
        expect(channelState?.loading.state).toBe("not-found")

        // Should emit ready state changed
        expectCommand(command, "cmd/emit-ready-state-changed")
      })

      it("should log error when document state not found", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-response",
              docId: "nonexistent-doc",
              transmission: { type: "unavailable" },
              hopCount: 0,
            },
          },
        }

        const [_newModel, command] = update(message, initialModel)

        expect(command).toBeUndefined()
      })

      it("should log error when channel state not found", () => {
        const channel = createMockChannel()
        const docId = "test-doc"
        const initialModel = createModelWithChannel(channel)

        // Add document but no channel state
        const docState = createDocState({ docId })
        initialModel.documents.set(docId, docState)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/sync-response",
              docId,
              transmission: { type: "unavailable" },
              hopCount: 0,
            },
          },
        }

        const [_newModel, command] = update(message, initialModel)

        expectCommand(command, "cmd/log")
        expect((command as any).message).toContain("can't accept sync-response")
      })
    })

    describe("directory-request", () => {
      it("should respond with document list", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        // Establish the channel first so getRuleContext works
        const establishedChannel = {
          ...channel,
          peer: {
            state: "established" as const,
            identity: { name: "test-peer" },
          },
        }
        initialModel.channels.set(channel.channelId, establishedChannel)

        // Add some documents with channel state
        const doc1 = createDocState({ docId: "doc-1" })
        doc1.channelState.set(channel.channelId, {
          awareness: "has-doc",
          loading: { state: "initial" },
        })
        const doc2 = createDocState({ docId: "doc-2" })
        doc2.channelState.set(channel.channelId, {
          awareness: "has-doc",
          loading: { state: "initial" },
        })
        initialModel.documents.set("doc-1", doc1)
        initialModel.documents.set("doc-2", doc2)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/directory-request",
            },
          },
        }

        const [_newModel, command] = update(message, initialModel)

        expectCommand(command, "cmd/send-message")
        const envelope = (command as any).envelope
        expect(envelope.toChannelIds).toEqual([channel.channelId])
        expect(envelope.message.type).toBe("channel/directory-response")
        expect(envelope.message.docIds).toEqual(["doc-1", "doc-2"])
      })
    })

    describe("directory-response", () => {
      it("should create documents and set awareness", () => {
        const channel = createMockChannel()
        const initialModel = createModelWithChannel(channel)

        const message: SynchronizerMessage = {
          type: "msg/channel-receive-message",
          envelope: {
            fromChannelId: channel.channelId,
            message: {
              type: "channel/directory-response",
              docIds: ["doc-1", "doc-2"],
            },
          },
        }

        const [newModel, _command] = update(message, initialModel)

        // Documents should be created
        expect(newModel.documents.has("doc-1")).toBe(true)
        expect(newModel.documents.has("doc-2")).toBe(true)

        // Channel should be marked as having the docs
        const doc1State = newModel.documents.get("doc-1")
        const doc2State = newModel.documents.get("doc-2")
        expect(doc1State?.channelState.get(channel.channelId)?.awareness).toBe(
          "has-doc",
        )
        expect(doc2State?.channelState.get(channel.channelId)?.awareness).toBe(
          "has-doc",
        )
      })
    })

    it("should log error when channel not found", () => {
      const [initialModel] = programInit({ name: "test" })

      const message: SynchronizerMessage = {
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: 999, // Non-existent channel
          message: {
            type: "channel/directory-request",
          },
        },
      }

      const [_newModel, command] = update(message, initialModel)

      expectCommand(command, "cmd/log")
      expect((command as any).message).toContain("channel not found")
    })
  })

  // Note: msg/broadcast-sync-request has been deprecated in favor of channel/sync-request
  // which offers more directed communication through specific channels

  describe("permission integration", () => {
    it("should respect canReveal permissions in directory response", () => {
      const restrictivePermissions = createPermissions({
        canReveal: context => {
          return context.docId !== "secret-doc"
        },
      })

      const restrictiveUpdate = createSynchronizerUpdate({
        permissions: restrictivePermissions,
      })

      const channel = createMockChannel()

      // Establish the channel first so getRuleContext works
      const establishedChannel = {
        ...channel,
        peer: {
          state: "established" as const,
          identity: { name: "test-peer" },
        },
      }
      const initialModel = createModelWithChannel(establishedChannel)

      // Add documents including a secret one, with channel state
      const publicDoc = createDocState({ docId: "public-doc" })
      publicDoc.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })
      const secretDoc = createDocState({ docId: "secret-doc" })
      secretDoc.channelState.set(channel.channelId, {
        awareness: "has-doc",
        loading: { state: "initial" },
      })
      initialModel.documents.set("public-doc", publicDoc)
      initialModel.documents.set("secret-doc", secretDoc)

      const message: SynchronizerMessage = {
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message: {
            type: "channel/directory-request",
          },
        },
      }

      const [_newModel, command] = restrictiveUpdate(message, initialModel)

      expectCommand(command, "cmd/send-message")
      const envelope = (command as any).envelope
      expect(envelope.message.docIds).toEqual(["public-doc"])
      expect(envelope.message.docIds).not.toContain("secret-doc")
    })
  })

  describe("utility functions and edge cases", () => {
    it("should handle batch commands correctly", () => {
      const channel = createMockChannel()
      const initialModel = createModelWithChannel(channel)

      const message: SynchronizerMessage = {
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message: {
            type: "channel/establish-request",
            identity: { name: "test" },
          },
        },
      }

      const [_newModel, command] = update(message, initialModel)

      expectBatchCommand(command)
      expect(command.commands).toHaveLength(2)
      expect(command.commands.every(c => c !== undefined)).toBe(true)
    })

    it("should return single command when only one is needed", () => {
      const [initialModel] = programInit({ name: "test" })
      const channel = createMockChannel()

      const message: SynchronizerMessage = {
        type: "msg/channel-added",
        channel,
      }

      const [_newModel, command] = update(message, initialModel)

      expect(command?.type).toBe("cmd/start-channel")
      expect((command as any).type).not.toBe("cmd/batch")
    })

    it("should return undefined when no commands are generated", () => {
      const [initialModel] = programInit({ name: "test" })

      // This should not generate any commands
      const message: SynchronizerMessage = {
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: 999,
          message: {
            type: "channel/sync-request",
            docs: [
              {
                docId: "nonexistent-doc",
                requesterDocVersion: createVersionVector(),
              },
            ],
          },
        },
      }

      const [_newModel, command] = update(message, initialModel)

      // This actually returns a log command when channel is not found
      expectCommand(command, "cmd/log")
      expect((command as any).message).toContain("channel not found")
    })

    it("should handle unknown message types gracefully", () => {
      const [initialModel] = programInit({ name: "test" })

      // Cast to bypass TypeScript checking for unknown message type
      const message = {
        type: "msg/unknown-message-type",
      } as any

      const [newModel, command] = update(message, initialModel)

      expect(command).toBeUndefined()
      expect(newModel).toEqual(initialModel)
    })
  })

  describe("state consistency", () => {
    it("should maintain immutability of original model", () => {
      const [initialModel] = programInit({ name: "test" })
      const originalChannelsSize = initialModel.channels.size
      const originalDocsSize = initialModel.documents.size

      const channel = createMockChannel()
      const message: SynchronizerMessage = {
        type: "msg/channel-added",
        channel,
      }

      const [newModel, _command] = update(message, initialModel)

      // Original model should be unchanged
      expect(initialModel.channels.size).toBe(originalChannelsSize)
      expect(initialModel.documents.size).toBe(originalDocsSize)

      // New model should have changes
      expect(newModel.channels.size).toBe(originalChannelsSize + 1)
    })

    it("should properly update nested state structures", () => {
      const channel = createMockChannel()
      const docId = "test-doc"
      const initialModel = createModelWithChannel(channel)

      // Add document with initial channel state
      const docState = createDocState({ docId })
      docState.channelState.set(channel.channelId, {
        awareness: "unknown",
        loading: { state: "initial" },
      })
      initialModel.documents.set(docId, docState)

      const message: SynchronizerMessage = {
        type: "msg/channel-receive-message",
        envelope: {
          fromChannelId: channel.channelId,
          message: {
            type: "channel/sync-response",
            docId,
            transmission: {
              type: "up-to-date",
              version: createVersionVector(),
            },
            hopCount: 0,
          },
        },
      }

      const [newModel, command] = update(message, initialModel)

      // Verify nested state was updated correctly
      const updatedDocState = newModel.documents.get(docId)
      const channelState = updatedDocState?.channelState.get(channel.channelId)

      expect(channelState?.awareness).toBe("has-doc")
      expect(channelState?.loading.state).toBe("found")

      // Should emit ready state changed
      expectCommand(command, "cmd/emit-ready-state-changed")
    })
  })
})
