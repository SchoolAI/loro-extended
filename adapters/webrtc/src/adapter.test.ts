import type { PeerID, PeerIdentityDetails } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebRtcDataChannelAdapter } from "./adapter.js"

/**
 * Create mock adapter hooks for testing
 */
function createMockHooks() {
  return {
    identity: {
      peerId: "0" as PeerID,
      name: "test-peer",
      type: "user" as const,
    } satisfies PeerIdentityDetails,
    onChannelAdded: vi.fn(),
    onChannelRemoved: vi.fn(),
    onChannelReceive: vi.fn(),
    onChannelEstablish: vi.fn(),
  }
}

/**
 * Mock RTCDataChannel for testing
 */
function createMockDataChannel(
  readyState: RTCDataChannelState = "connecting",
): RTCDataChannel {
  const listeners = new Map<string, Set<EventListener>>()

  const channel = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      let l = listeners.get(type)
      if (!l) {
        l = new Set()
        listeners.set(type, l)
      }
      l.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    }),
    // Helper to trigger events in tests
    _emit: (type: string, event?: Event) => {
      const eventListeners = listeners.get(type)
      if (eventListeners) {
        for (const listener of eventListeners) {
          listener(event ?? new Event(type))
        }
      }
    },
    _setReadyState: (state: RTCDataChannelState) => {
      ;(channel as any).readyState = state
    },
  } as unknown as RTCDataChannel & {
    _emit: (type: string, event?: Event) => void
    _setReadyState: (state: RTCDataChannelState) => void
  }

  return channel
}

/**
 * Initialize and start an adapter for testing
 */
async function initializeAdapter(adapter: WebRtcDataChannelAdapter) {
  const hooks = createMockHooks()
  adapter._initialize(hooks)
  await adapter._start()
  return hooks
}

describe("WebRtcDataChannelAdapter", () => {
  let adapter: WebRtcDataChannelAdapter

  beforeEach(() => {
    adapter = new WebRtcDataChannelAdapter()
  })

  afterEach(async () => {
    // Clean up - stop the adapter if it was started
    try {
      await adapter._stop()
    } catch {
      // Ignore errors if adapter wasn't started
    }
  })

  describe("constructor", () => {
    it("should create adapter with correct adapterType", () => {
      expect(adapter).toBeInstanceOf(WebRtcDataChannelAdapter)
      expect(adapter.adapterType).toBe("webrtc-datachannel")
    })
  })

  describe("attachDataChannel", () => {
    it("should attach a data channel for a peer", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      expect(adapter.hasDataChannel(peerId)).toBe(true)
    })

    it("should return a cleanup function", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      const cleanup = adapter.attachDataChannel(peerId, dataChannel)

      expect(typeof cleanup).toBe("function")
    })

    it("should add event listeners to the data channel", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("connecting")

      adapter.attachDataChannel(peerId, dataChannel)

      expect(dataChannel.addEventListener).toHaveBeenCalledWith(
        "open",
        expect.any(Function),
      )
      expect(dataChannel.addEventListener).toHaveBeenCalledWith(
        "close",
        expect.any(Function),
      )
      expect(dataChannel.addEventListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
      )
      expect(dataChannel.addEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      )
    })

    it("should detach old channel if attaching same peer twice", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel1 = createMockDataChannel("open")
      const dataChannel2 = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel1)
      adapter.attachDataChannel(peerId, dataChannel2)

      // Old channel should have listeners removed
      expect(dataChannel1.removeEventListener).toHaveBeenCalled()
      expect(adapter.hasDataChannel(peerId)).toBe(true)
    })

    it("should create Loro channel immediately if data channel is open", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Should have called onChannelAdded
      expect(hooks.onChannelAdded).toHaveBeenCalled()
    })

    it("should wait for open event if data channel is connecting", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("connecting")

      adapter.attachDataChannel(peerId, dataChannel)

      // Should NOT have called onChannelAdded yet
      expect(hooks.onChannelAdded).not.toHaveBeenCalled()

      // Simulate open event
      ;(dataChannel as any)._setReadyState("open")
      ;(dataChannel as any)._emit("open")

      // Now should have called onChannelAdded
      expect(hooks.onChannelAdded).toHaveBeenCalled()
    })
  })

  describe("detachDataChannel", () => {
    it("should detach a data channel for a peer", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)
      adapter.detachDataChannel(peerId)

      expect(adapter.hasDataChannel(peerId)).toBe(false)
    })

    it("should remove event listeners from the data channel", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)
      adapter.detachDataChannel(peerId)

      expect(dataChannel.removeEventListener).toHaveBeenCalledWith(
        "open",
        expect.any(Function),
      )
      expect(dataChannel.removeEventListener).toHaveBeenCalledWith(
        "close",
        expect.any(Function),
      )
      expect(dataChannel.removeEventListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
      )
      expect(dataChannel.removeEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function),
      )
    })

    it("should do nothing if peer not attached", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID

      // Should not throw
      adapter.detachDataChannel(peerId)

      expect(adapter.hasDataChannel(peerId)).toBe(false)
    })

    it("should call onChannelRemoved when detaching", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)
      adapter.detachDataChannel(peerId)

      expect(hooks.onChannelRemoved).toHaveBeenCalled()
    })
  })

  describe("hasDataChannel", () => {
    it("should return false for unknown peer", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID

      expect(adapter.hasDataChannel(peerId)).toBe(false)
    })

    it("should return true for attached peer", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      expect(adapter.hasDataChannel(peerId)).toBe(true)
    })
  })

  describe("getAttachedPeerIds", () => {
    it("should return empty array when no peers attached", async () => {
      await initializeAdapter(adapter)

      expect(adapter.getAttachedPeerIds()).toEqual([])
    })

    it("should return all attached peer IDs", async () => {
      await initializeAdapter(adapter)
      const peerId1 = "12345" as PeerID
      const peerId2 = "67890" as PeerID
      const dataChannel1 = createMockDataChannel("open")
      const dataChannel2 = createMockDataChannel("open")

      adapter.attachDataChannel(peerId1, dataChannel1)
      adapter.attachDataChannel(peerId2, dataChannel2)

      const peerIds = adapter.getAttachedPeerIds()
      expect(peerIds).toHaveLength(2)
      expect(peerIds).toContain(peerId1)
      expect(peerIds).toContain(peerId2)
    })
  })

  describe("cleanup function", () => {
    it("should detach the channel when called", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      const cleanup = adapter.attachDataChannel(peerId, dataChannel)
      cleanup()

      expect(adapter.hasDataChannel(peerId)).toBe(false)
    })
  })

  describe("data channel events", () => {
    it("should handle close event by removing Loro channel", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Simulate close event
      ;(dataChannel as any)._emit("close")

      // Channel should still be tracked (for potential reconnection)
      // but the Loro channel should be removed
      expect(adapter.hasDataChannel(peerId)).toBe(true)
      // onChannelRemoved should have been called
      expect(hooks.onChannelRemoved).toHaveBeenCalled()
    })

    it("should handle error event", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Simulate error event - should not throw
      ;(dataChannel as any)._emit("error", new Event("error"))

      expect(adapter.hasDataChannel(peerId)).toBe(true)
      // onChannelRemoved should have been called due to error
      expect(hooks.onChannelRemoved).toHaveBeenCalled()
    })
  })

  describe("message handling", () => {
    it("should deserialize and forward messages to Loro channel", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Create a mock message event with a serialized channel message
      const serializedMsg = JSON.stringify({
        type: "channel/establish-request",
        identity: { peerId: "67890", name: "remote-peer", type: "user" },
      })
      const messageEvent = new MessageEvent("message", { data: serializedMsg })

      // Simulate message event
      ;(dataChannel as any)._emit("message", messageEvent)

      // onChannelReceive should have been called
      expect(hooks.onChannelReceive).toHaveBeenCalled()
    })
  })

  describe("onStop", () => {
    it("should clean up all attached channels", async () => {
      await initializeAdapter(adapter)
      const peerId1 = "12345" as PeerID
      const peerId2 = "67890" as PeerID
      const dataChannel1 = createMockDataChannel("open")
      const dataChannel2 = createMockDataChannel("open")

      adapter.attachDataChannel(peerId1, dataChannel1)
      adapter.attachDataChannel(peerId2, dataChannel2)

      await adapter._stop()

      expect(adapter.hasDataChannel(peerId1)).toBe(false)
      expect(adapter.hasDataChannel(peerId2)).toBe(false)
    })
  })
})
