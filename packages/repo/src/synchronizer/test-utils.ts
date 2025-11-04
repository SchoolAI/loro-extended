/** biome-ignore-all lint/suspicious/noExplicitAny: test utilities */

import { LoroDoc, type PeerID } from "loro-crdt"
import { vi } from "vitest"
import type {
  Channel,
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
    adapterId: "test-adapter",
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
    { awareness: "has-doc" | "no-doc"; version?: any }
  > = new Map(),
): SynchronizerModel {
  const model = createModelWithChannel(channel)

  const documentAwareness = new Map(
    Array.from(docAwareness.entries()).map(
      ([docId, { awareness, version }]) => [
        docId,
        {
          awareness,
          lastKnownVersion: version,
          lastUpdated: new Date(),
        },
      ],
    ),
  )

  model.peers.set(peerId, {
    identity: { peerId, name: "known-peer" },
    documentAwareness,
    subscriptions: new Set(),
    lastSeen: new Date(Date.now() - 60000),
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
        identity: { peerId, name: "peer" },
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
