/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { LoroDoc, type PeerID } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "./adapter/adapter.js"
import type {
  Channel,
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "./channel.js"
import { createRules } from "./rules.js"
import { Synchronizer } from "./synchronizer.js"
import type { ChannelId } from "./types.js"

// Mock adapter for testing
class MockAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: vi.fn((message: ChannelMsg) => {
        this.sentMessages.push({ channelId: context.name, message })
      }),
      stop: vi.fn(),
    }
  }

  async onStart(): Promise<void> {
    // Nothing to do for mock adapter
  }

  async onStop(): Promise<void> {
    this.testChannels.clear()
  }

  // Override _start to track when it completes
  async _start(): Promise<void> {
    this.startPromise = super._start()
    await this.startPromise
  }

  // Wait for adapter to be started
  async waitForStart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise
    }
  }

  // Test helpers
  public simulateChannelAdded(name: string): ConnectedChannel {
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    // Establish the channel to trigger the establishment handshake
    this.establishChannel(channel.channelId)
    return channel
  }

  public simulateChannelRemoved(channelId: ChannelId): Channel | undefined {
    const channel = this.removeChannel(channelId)
    if (channel) {
      this.testChannels.delete(channelId)
    }
    return channel
  }

  public simulateChannelMessage(channelId: ChannelId, message: ChannelMsg) {
    const channel = this.testChannels.get(channelId)
    if (channel?.onReceive) {
      channel.onReceive(message)
    }
  }

  public getTestChannels() {
    return this.testChannels
  }
}

// Helper to create a version vector
function createVersionVector() {
  const doc = new LoroDoc()
  return doc.version()
}

describe("Synchronizer - Event Emission", () => {
  let synchronizer: Synchronizer
  let mockAdapter: MockAdapter

  beforeEach(() => {
    mockAdapter = new MockAdapter({ adapterId: "test-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [mockAdapter as AnyAdapter],
      rules: createRules(),
    })
  })

  it("should emit ready-state-changed events", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Set up event listener
    const readyStatePromise = new Promise(resolve => {
      synchronizer.emitter.on("ready-state-changed", resolve)
    })

    // Simulate sync response that changes loading state
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "up-to-date",
        version: createVersionVector(),
      },
    })

    const event = await readyStatePromise
    expect(event).toMatchObject({
      docId,
      readyStates: expect.any(Array),
    })
  })

  it("should support waitUntilReady with predicate", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const channel = mockAdapter.simulateChannelAdded("test-channel")
    synchronizer.getOrCreateDocumentState(docId)

    // Establish the channel first
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId: "1", name: "test-peer", type: "user" },
    })

    // Start waiting for ready state
    const waitPromise = synchronizer.waitUntilReady(docId, readyStates =>
      readyStates.some(state => state.state === "loaded"),
    )

    // Simulate sync response that satisfies the predicate
    setImmediate(() => {
      mockAdapter.simulateChannelMessage(channel.channelId, {
        type: "channel/sync-response",
        docId,
        transmission: {
          type: "up-to-date",
          version: createVersionVector(),
        },
      })
    })

    // Should resolve when predicate is satisfied
    await expect(waitPromise).resolves.toBeUndefined()
  })

  it("should emit ready-state-changed when document is deleted", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"

    // Create a document
    synchronizer.getOrCreateDocumentState(docId)

    // Collect all ready-state-changed events
    const events: Array<{ docId: string; readyStates: any[] }> = []
    synchronizer.emitter.on("ready-state-changed", event => {
      events.push(event)
    })

    // Delete the document
    await synchronizer.removeDocument(docId)

    // Should have emitted a ready-state-changed event for the deleted document
    const deleteEvent = events.find(e => e.docId === docId)
    expect(deleteEvent).toBeDefined()
    // The ready state should show "absent" for our identity after deletion
    expect(deleteEvent?.readyStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "absent",
          docId,
        }),
      ]),
    )
  })

  it("should clean up cached ready states when document is deleted", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"

    // Create a document
    synchronizer.getOrCreateDocumentState(docId)

    // Verify the ready state is cached
    expect(synchronizer.readyStates.has(docId)).toBe(true)

    // Delete the document
    await synchronizer.removeDocument(docId)

    // The cached ready state should be cleaned up
    expect(synchronizer.readyStates.has(docId)).toBe(false)
  })

  it("should emit ready-state-changed when peer disconnects", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"
    const peerId = "peer-1" as PeerID

    // Create a document
    synchronizer.getOrCreateDocumentState(docId)

    // Add a channel and establish it
    const channel = mockAdapter.simulateChannelAdded("test-channel")

    // Establish the channel with a peer
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/establish-request",
      identity: { peerId, name: "test-peer", type: "user" },
    })

    // Simulate peer having the document (sync-response with up-to-date)
    mockAdapter.simulateChannelMessage(channel.channelId, {
      type: "channel/sync-response",
      docId,
      transmission: {
        type: "up-to-date",
        version: createVersionVector(),
      },
    })

    // Verify peer is in ready states
    let readyStates = synchronizer.getReadyStates(docId)
    const peerReadyState = readyStates.find(rs => rs.identity.peerId === peerId)
    expect(peerReadyState).toBeDefined()

    // Set up promise to wait for the event
    const eventPromise = new Promise<{ docId: string; readyStates: any[] }>(
      resolve => {
        synchronizer.emitter.on("ready-state-changed", event => {
          if (event.docId === docId) {
            resolve(event)
          }
        })
      },
    )

    // Disconnect the peer (remove channel)
    mockAdapter.simulateChannelRemoved(channel.channelId)

    // Wait for the event (with timeout)
    const disconnectEvent = await Promise.race([
      eventPromise,
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), 100),
      ),
    ])

    // Should have emitted ready-state-changed
    expect(disconnectEvent).toBeDefined()

    // Peer should no longer be in ready states (or their channels should be empty)
    readyStates = synchronizer.getReadyStates(docId)
    const peerAfterDisconnect = readyStates.find(
      rs => rs.identity.peerId === peerId,
    )
    // After disconnect, peer may still exist but with no channels
    if (peerAfterDisconnect && peerAfterDisconnect.state !== "absent") {
      expect(peerAfterDisconnect.channels).toHaveLength(0)
    }
  })

  it("should emit ready-state-changed when document is first created", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"

    // Set up promise to wait for the event BEFORE creating document
    const eventPromise = new Promise<{ docId: string; readyStates: any[] }>(
      resolve => {
        synchronizer.emitter.on("ready-state-changed", event => {
          if (event.docId === docId) {
            resolve(event)
          }
        })
      },
    )

    // Create a document (should emit ready-state-changed)
    synchronizer.getOrCreateDocumentState(docId)

    // Wait for the event (with timeout)
    const createEvent = await Promise.race([
      eventPromise,
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), 100),
      ),
    ])

    // Should have emitted ready-state-changed
    expect(createEvent).toBeDefined()
    // Our state should be "aware" (empty document)
    const ourState = createEvent?.readyStates.find(
      rs => rs.identity.peerId === synchronizer.identity.peerId,
    )
    expect(ourState?.state).toBe("aware")
  })

  it("should emit ready-state-changed when document transitions from aware to loaded", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"

    // Create a document (starts as "aware" - no ops yet)
    const docState = synchronizer.getOrCreateDocumentState(docId)

    // Wait for initial creation event to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify initial state is "aware"
    let readyStates = synchronizer.getReadyStates(docId)
    let ourState = readyStates.find(
      rs => rs.identity.peerId === synchronizer.identity.peerId,
    )
    expect(ourState?.state).toBe("aware")

    // Set up promise to wait for the event BEFORE making changes
    const eventPromise = new Promise<{ docId: string; readyStates: any[] }>(
      resolve => {
        synchronizer.emitter.on("ready-state-changed", event => {
          if (
            event.docId === docId &&
            event.readyStates.some(rs => rs.state === "loaded")
          ) {
            resolve(event)
          }
        })
      },
    )

    // Add content to the document (should transition to "loaded")
    // This triggers subscribeLocalUpdates callback which dispatches local-doc-change
    docState.doc.getText("text").insert(0, "hello")
    docState.doc.commit() // Required to trigger subscribeLocalUpdates

    // Wait for the event (with timeout)
    const loadedEvent = await Promise.race([
      eventPromise,
      new Promise<undefined>(resolve =>
        setTimeout(() => resolve(undefined), 100),
      ),
    ])

    // Should have emitted ready-state-changed
    expect(loadedEvent).toBeDefined()

    // Our state should now be "loaded"
    ourState = loadedEvent?.readyStates.find(
      rs => rs.identity.peerId === synchronizer.identity.peerId,
    )
    expect(ourState?.state).toBe("loaded")

    // Verify via getReadyStates as well
    readyStates = synchronizer.getReadyStates(docId)
    ourState = readyStates.find(
      rs => rs.identity.peerId === synchronizer.identity.peerId,
    )
    expect(ourState?.state).toBe("loaded")
  })

  it("should NOT emit ready-state-changed when state has not changed", async () => {
    await mockAdapter.waitForStart()
    const docId = "test-doc"

    // Create a document with content (starts as "loaded")
    const docState = synchronizer.getOrCreateDocumentState(docId)
    docState.doc.getText("text").insert(0, "hello")
    docState.doc.commit()

    // Wait for initial events to settle
    await new Promise(resolve => setTimeout(resolve, 50))

    // Collect events from this point forward
    const events: Array<{ docId: string; readyStates: any[] }> = []
    synchronizer.emitter.on("ready-state-changed", event => {
      events.push(event)
    })

    // Add more content (state should still be "loaded", no structural change)
    docState.doc.getText("text").insert(5, " world")
    docState.doc.commit()

    // Wait a bit for any potential events
    await new Promise(resolve => setTimeout(resolve, 50))

    // Should NOT have emitted ready-state-changed
    // The document content changed, but the ready state (state="loaded", channels, identity)
    // did not change. Since lastKnownVersion is no longer part of ReadyState,
    // content changes should not trigger ready-state-changed events.
    const docEvents = events.filter(e => e.docId === docId)
    expect(docEvents).toHaveLength(0)
  })
})
