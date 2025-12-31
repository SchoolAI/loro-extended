/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

/**
 * Tests for multi-channel peer scenarios
 *
 * These tests verify correct behavior when the same peer connects via multiple
 * channels (e.g., SSE + WebRTC). Key scenarios:
 *
 * 1. Ephemeral data should NOT be removed when one channel is removed if the
 *    peer still has other active channels
 * 2. Sync-request should not cause duplicate subscriptions
 */

import { type PeerID, VersionVector } from "loro-crdt"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Adapter, type AnyAdapter } from "../adapter/adapter.js"
import type {
  ChannelMsg,
  ConnectedChannel,
  GeneratedChannel,
} from "../channel.js"
import { createPermissions } from "../permissions.js"
import { Synchronizer } from "../synchronizer.js"
import type { ChannelId } from "../types.js"

// Mock adapter for testing - simulates SSE or WebRTC adapter
class MockNetworkAdapter extends Adapter<{ name: string }> {
  public sentMessages: any[] = []
  private testChannels: Map<ChannelId, ConnectedChannel> = new Map()
  private startPromise: Promise<void> | null = null

  protected generate(context: { name: string }): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
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

  async _start(): Promise<void> {
    this.startPromise = super._start()
    await this.startPromise
  }

  async waitForStart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise
    }
  }

  public simulateChannelAdded(name: string): ConnectedChannel {
    const channel = this.addChannel({ name })
    this.testChannels.set(channel.channelId, channel)
    this.establishChannel(channel.channelId)
    return channel
  }

  public simulateChannelRemoved(channelId: ChannelId): void {
    const channel = this.removeChannel(channelId)
    if (channel) {
      this.testChannels.delete(channelId)
    }
  }

  public getTestChannel(channelId: ChannelId): ConnectedChannel | undefined {
    return this.testChannels.get(channelId)
  }
}

describe("Multi-channel peer scenarios", () => {
  let synchronizer: Synchronizer
  let sseAdapter: MockNetworkAdapter
  let webrtcAdapter: MockNetworkAdapter

  const remotePeerId: PeerID = "123"

  beforeEach(() => {
    sseAdapter = new MockNetworkAdapter({ adapterType: "sse-adapter" })
    webrtcAdapter = new MockNetworkAdapter({ adapterType: "webrtc-adapter" })
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-synchronizer", type: "user" },
      adapters: [sseAdapter as AnyAdapter, webrtcAdapter as AnyAdapter],
      permissions: createPermissions(),
    })
  })

  describe("Ephemeral data preservation", () => {
    it("should NOT remove ephemeral peer when one channel is removed if peer has other channels", async () => {
      await sseAdapter.waitForStart()
      await webrtcAdapter.waitForStart()

      // Add first channel (SSE)
      const sseChannel = sseAdapter.simulateChannelAdded("sse-channel")

      // Establish the SSE channel with the remote peer
      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/establish-response",
        identity: {
          peerId: remotePeerId,
          name: "remote-peer",
          type: "user",
        },
      })

      // Verify peer state exists with one channel
      const establishedSseChannel = synchronizer.model.channels.get(
        sseChannel.channelId,
      )
      expect(establishedSseChannel?.type).toBe("established")

      // Add second channel (WebRTC) for the SAME peer
      const webrtcChannel = webrtcAdapter.simulateChannelAdded("webrtc-channel")

      // Establish WebRTC channel with the same peer
      synchronizer.channelReceive(webrtcChannel.channelId, {
        type: "channel/establish-response",
        identity: {
          peerId: remotePeerId, // Same peer ID!
          name: "remote-peer",
          type: "user",
        },
      })

      // Verify peer now has two channels
      const establishedWebrtcChannel = synchronizer.model.channels.get(
        webrtcChannel.channelId,
      )
      expect(establishedWebrtcChannel?.type).toBe("established")

      // Create a document and subscribe the peer to it
      const docId = "test-doc"
      synchronizer.getOrCreateDocumentState(docId)

      // Simulate sync-request from peer on SSE channel
      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/sync-request",
        docId,
        requesterDocVersion: new VersionVector(null),
        bidirectional: false,
      })

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10))

      // Now remove the SSE channel (simulating SSE disconnect)
      sseAdapter.simulateChannelRemoved(sseChannel.channelId)

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10))

      // The WebRTC channel should still be active
      const webrtcChannelAfterRemoval = synchronizer.model.channels.get(
        webrtcChannel.channelId,
      )
      expect(webrtcChannelAfterRemoval).toBeDefined()
      expect(webrtcChannelAfterRemoval?.type).toBe("established")

      // The peer's subscription should still exist (ephemeral data preserved)
      // We can verify this by checking that the peer can still receive updates
      const docIds = synchronizer.getChannelDocIds(webrtcChannel.channelId)
      expect(docIds).toContain(docId)
    })

    it("should remove ephemeral peer when the LAST channel for a peer is removed", async () => {
      await sseAdapter.waitForStart()

      // Add only one channel
      const sseChannel = sseAdapter.simulateChannelAdded("sse-channel")

      // Establish the channel
      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/establish-response",
        identity: {
          peerId: remotePeerId,
          name: "remote-peer",
          type: "user",
        },
      })

      // Create a document and subscribe the peer
      const docId = "test-doc"
      synchronizer.getOrCreateDocumentState(docId)

      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/sync-request",
        docId,
        requesterDocVersion: new VersionVector(null),
        bidirectional: false,
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      // Remove the only channel
      sseAdapter.simulateChannelRemoved(sseChannel.channelId)

      await new Promise(resolve => setTimeout(resolve, 10))

      // Channel should be gone
      expect(
        synchronizer.model.channels.get(sseChannel.channelId),
      ).toBeUndefined()

      // Peer's ephemeral data should be cleaned up
      // (We can't directly check this, but the channel removal should have triggered cleanup)
    })
  })

  describe("Sync-request deduplication across channels", () => {
    it("should maintain subscription when peer sends sync-request via second channel", async () => {
      await sseAdapter.waitForStart()
      await webrtcAdapter.waitForStart()

      const docId = "shared-doc"
      synchronizer.getOrCreateDocumentState(docId)

      // Add and establish SSE channel
      const sseChannel = sseAdapter.simulateChannelAdded("sse-channel")

      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/establish-response",
        identity: { peerId: remotePeerId, name: "remote-peer", type: "user" },
      })

      // Subscribe via SSE channel
      synchronizer.channelReceive(sseChannel.channelId, {
        type: "channel/sync-request",
        docId,
        requesterDocVersion: new VersionVector(null),
        bidirectional: false,
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      // Verify subscription exists
      let docIds = synchronizer.getChannelDocIds(sseChannel.channelId)
      expect(docIds).toContain(docId)

      // Add and establish WebRTC channel for same peer
      const webrtcChannel = webrtcAdapter.simulateChannelAdded("webrtc-channel")

      synchronizer.channelReceive(webrtcChannel.channelId, {
        type: "channel/establish-response",
        identity: { peerId: remotePeerId, name: "remote-peer", type: "user" },
      })

      // Send sync-request via WebRTC channel (same doc)
      synchronizer.channelReceive(webrtcChannel.channelId, {
        type: "channel/sync-request",
        docId,
        requesterDocVersion: new VersionVector(null),
        bidirectional: false,
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      // Both channels should show the subscription
      docIds = synchronizer.getChannelDocIds(sseChannel.channelId)
      expect(docIds).toContain(docId)

      docIds = synchronizer.getChannelDocIds(webrtcChannel.channelId)
      expect(docIds).toContain(docId)
    })
  })
})
