/** biome-ignore-all lint/suspicious/noExplicitAny: test utilities */

import Emittery from "emittery"
import { LoroDoc, type PeerID } from "loro-crdt"
import { vi } from "vitest"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  EstablishedChannel,
} from "../channel.js"
import {
  type Command,
  type createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
  type SynchronizerModel,
} from "../synchronizer-program.js"
import type { ChannelId, DocId, PeerDocSyncState } from "../types.js"
import type { CommandContext } from "./command-executor.js"

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// MICROTASK FLUSHING UTILITIES
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Wait for microtasks to complete.
 *
 * ## Background
 *
 * The Synchronizer now uses a **receive queue** to handle message processing.
 * When a message arrives during dispatch, it's queued and processed after the
 * current dispatch completes. This prevents infinite recursion without requiring
 * async boundaries.
 *
 * ## When is this needed?
 *
 * In most cases, `flushMicrotasks()` is **no longer needed** because:
 * - MockAdapter delivers messages synchronously
 * - The Synchronizer's receive queue processes them iteratively
 * - Sends happen synchronously at the end of each dispatch
 *
 * However, you may still need it for:
 * - Tests that use real async adapters (WebSocket, SSE)
 * - Tests that need to wait for other async operations
 * - Legacy tests that haven't been updated yet
 *
 * ## Example
 *
 * ```typescript
 * // With MockAdapter, this is usually sufficient:
 * mockAdapter.simulateChannelMessage(channelId, syncRequest)
 * expect(mockAdapter.sentMessages.length).toBeGreaterThan(0)
 *
 * // But if you need to wait for async operations:
 * await flushMicrotasks()
 * ```
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(() => resolve()))
}

/**
 * Simulate a channel message and optionally wait for async operations.
 *
 * This is a convenience wrapper that combines:
 * 1. Calling `channel.onReceive(message)` to simulate receiving a message
 * 2. Calling `flushMicrotasks()` to wait for any async operations
 *
 * Note: With the receive queue implementation, the flush is often unnecessary
 * for MockAdapter tests, but this helper is kept for compatibility and for
 * tests that may have other async dependencies.
 *
 * @param channels - Map of channelId to ConnectedChannel (from MockAdapter.getTestChannels())
 * @param channelId - The channel ID to simulate the message on
 * @param message - The message to simulate receiving
 *
 * @example
 * ```typescript
 * await simulateAndFlush(
 *   mockAdapter.getTestChannels(),
 *   channel.channelId,
 *   { type: "channel/sync-request", docId: "test", ... }
 * )
 * // Messages are now in mockAdapter.sentMessages
 * ```
 */
export async function simulateAndFlush(
  channels: Map<ChannelId, ConnectedChannel>,
  channelId: ChannelId,
  message: ChannelMsg,
): Promise<void> {
  const channel = channels.get(channelId)
  if (channel?.onReceive) {
    channel.onReceive(message)
  }
  await flushMicrotasks()
}

/**
 * Creates a mock connected channel for testing
 */
export function createMockChannel(
  overrides: Partial<ConnectedChannel> = {},
): ConnectedChannel {
  const baseSend = vi.fn()
  return {
    type: "connected",
    channelId: 1,
    kind: "network",
    adapterType: "test-adapter",
    send: baseSend,
    stop: vi.fn(),
    onReceive: vi.fn(),
    ...overrides,
  }
}

/**
 * Creates an established channel with a peer ID
 */
export function createEstablishedChannel(
  peerId: PeerID,
  overrides: Partial<ConnectedChannel> = {},
): EstablishedChannel {
  const channel = createMockChannel(overrides)
  return {
    ...channel,
    type: "established" as const,
    peerId,
  }
}

/**
 * Creates a synchronizer model with a channel already added
 */
export function createModelWithChannel(channel: Channel): SynchronizerModel {
  const [model] = programInit({
    peerId: "test-peer-id" as PeerID,
    name: "test-identity",
    type: "user",
  })
  model.channels.set(channel.channelId, channel)
  return model
}

/**
 * Creates a model with a known peer (for reconnection tests)
 */
export function createModelWithKnownPeer(
  channel: Channel,
  peerId: PeerID,
  docAwareness: Map<
    string,
    { awareness: "synced" | "absent"; version?: any }
  > = new Map(),
): SynchronizerModel {
  const model = createModelWithChannel(channel)

  const documentAwareness = new Map<DocId, PeerDocSyncState>()
  for (const [docId, { awareness, version }] of docAwareness.entries()) {
    const lastUpdated = new Date()
    if (awareness === "synced") {
      documentAwareness.set(docId, {
        status: "synced",
        lastKnownVersion: version,
        lastUpdated,
      })
    } else {
      documentAwareness.set(docId, {
        status: "absent",
        lastUpdated,
      })
    }
  }

  model.peers.set(peerId, {
    identity: { peerId, name: "known-peer", type: "user" },
    docSyncStates: documentAwareness,
    subscriptions: new Set(),
    channels: new Set(),
  })

  return model
}

/**
 * Creates a proper VersionVector for testing
 */
export function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

/**
 * Helper to send establish-response and get result
 */
export function sendEstablishResponse(
  model: SynchronizerModel,
  channelId: number,
  peerId: PeerID,
  update: ReturnType<typeof createSynchronizerUpdate>,
) {
  const message: SynchronizerMessage = {
    type: "synchronizer/channel-receive-message",
    envelope: {
      fromChannelId: channelId,
      message: {
        type: "channel/establish-response",
        identity: { peerId, name: "peer", type: "user" },
      },
    },
  }
  return update(message, model)
}

/**
 * Asserts that a command is defined and has the expected type.
 * Uses a generic type parameter to automatically narrow the command type.
 */
export function expectCommand<T extends Command["type"]>(
  command: Command | undefined,
  expectedType: T,
): asserts command is Extract<Command, { type: T }> {
  if (!command) {
    throw new Error("command is undefined")
  }
  if (command.type !== expectedType) {
    throw new Error(
      `Expected command type "${expectedType}" but got "${command.type}"`,
    )
  }
}

/**
 * Asserts that a command is a batch command
 */
export function expectBatchCommand(
  command: Command | undefined,
): asserts command is Extract<Command, { type: "cmd/batch" }> {
  if (!command) {
    throw new Error("command is undefined")
  }
  if (command.type !== "cmd/batch") {
    throw new Error(`Expected batch command but got "${command.type}"`)
  }
}

/**
 * Find a message in sentMessages array, looking inside channel/batch wrappers.
 * This is needed because the deferred send pattern may batch multiple messages together.
 *
 * @param sentMessages Array of { channelId, message } objects from MockAdapter
 * @param type The message type to find (e.g., "channel/sync-response")
 * @returns The found message wrapper { channelId, message } or undefined
 */
export function findMessage(
  sentMessages: { channelId: any; message: any }[],
  type: string,
): { channelId: any; message: any } | undefined {
  for (const msg of sentMessages) {
    if (msg.message.type === type) {
      return msg
    }
    if (msg.message.type === "channel/batch") {
      const found = msg.message.messages.find((m: any) => m.type === type)
      if (found) {
        return { channelId: msg.channelId, message: found }
      }
    }
  }
  return undefined
}

/**
 * Find all messages of a given type in sentMessages array, looking inside channel/batch wrappers.
 *
 * @param sentMessages Array of { channelId, message } objects from MockAdapter
 * @param type The message type to find (e.g., "channel/sync-response")
 * @returns Array of found message wrappers { channelId, message }
 */
export function findAllMessages(
  sentMessages: { channelId: any; message: any }[],
  type: string,
): { channelId: any; message: any }[] {
  const results: { channelId: any; message: any }[] = []
  for (const msg of sentMessages) {
    if (msg.message.type === type) {
      results.push(msg)
    }
    if (msg.message.type === "channel/batch") {
      for (const m of msg.message.messages) {
        if (m.type === type) {
          results.push({ channelId: msg.channelId, message: m })
        }
      }
    }
  }
  return results
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// COMMAND HANDLER TEST UTILITIES
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Creates a mock logger for testing command handlers.
 * All methods are vi.fn() mocks that can be inspected.
 */
export function createMockLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    getChild: vi.fn(() => createMockLogger()),
  }
}

/**
 * Creates a mock AdapterManager for testing command handlers.
 */
export function createMockAdapterManager() {
  return {
    adapters: [],
    sendEstablishmentMessage: vi.fn(() => 0),
    sendEstablishedMessage: vi.fn(() => 0),
    getChannel: vi.fn(() => undefined),
    getAllChannels: vi.fn(() => []),
  }
}

/**
 * Creates a mock EphemeralStoreManager for testing command handlers.
 */
export function createMockEphemeralStoreManager() {
  return {
    getStore: vi.fn(() => undefined),
    getOrCreateStore: vi.fn(() => ({
      apply: vi.fn(),
      encodeAll: vi.fn(() => new Uint8Array(0)),
      getAllStates: vi.fn(() => ({})),
      delete: vi.fn(),
      touch: vi.fn(),
    })),
    removeStore: vi.fn(),
    getAllStores: vi.fn(() => new Map()),
  }
}

/**
 * Creates a mock OutboundBatcher for testing command handlers.
 */
export function createMockOutboundBatcher() {
  return {
    queue: vi.fn(),
    flush: vi.fn(),
    clear: vi.fn(),
    getPendingCount: vi.fn(() => 0),
  }
}

/**
 * Creates a mock EphemeralStore for testing command handlers.
 */
export function createMockEphemeralStore() {
  return {
    apply: vi.fn(),
    encodeAll: vi.fn(() => new Uint8Array([1, 2, 3])),
    getAllStates: vi.fn(() => ({})),
    delete: vi.fn(),
    touch: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
  }
}

/**
 * Creates a mock CommandContext for testing command handlers in isolation.
 *
 * This allows testing individual command handlers without needing the full
 * Synchronizer infrastructure. All dependencies are mocked with vi.fn().
 *
 * @param overrides - Partial context to override default mocks
 * @returns A complete CommandContext with all methods mocked
 *
 * @example
 * ```typescript
 * const ctx = createMockCommandContext({
 *   getOrCreateNamespacedStore: vi.fn(() => mockStore),
 * })
 *
 * handleApplyEphemeral(command, ctx)
 *
 * expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledWith("doc-1", "presence")
 * ```
 */
export function createMockCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  const mockChannel = createMockChannel()
  const model = createModelWithChannel(mockChannel)

  return {
    model,
    adapters: createMockAdapterManager() as any,
    ephemeralManager: createMockEphemeralStoreManager() as any,
    outboundBatcher: createMockOutboundBatcher() as any,
    emitter: new Emittery(),
    identity: { peerId: "test-peer" as PeerID, name: "test", type: "user" },
    logger: createMockLogger() as any,
    dispatch: vi.fn(),
    executeCommand: vi.fn(),
    validateChannelForSend: vi.fn(() => true),
    queueSend: vi.fn(),
    getNamespacedStore: vi.fn(() => undefined),
    getOrCreateNamespacedStore: vi.fn(() => createMockEphemeralStore() as any),
    encodeAllPeerStores: vi.fn(() => []),
    buildSyncResponseMessage: vi.fn(() => undefined),
    buildSyncRequestMessage: vi.fn(() => ({
      type: "channel/sync-request" as const,
      docId: "test-doc",
      requesterDocVersion: createVersionVector(),
      bidirectional: false,
    })),
    docNamespacedStores: new Map(),
    ...overrides,
  }
}
