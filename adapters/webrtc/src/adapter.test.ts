import { getLogger } from "@logtape/logtape"
import type { PeerID, PeerIdentityDetails } from "@loro-extended/repo"
import {
  decodeFrame,
  encodeFrame,
  parseTransportPayload,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"
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
    logger: getLogger(["test"]),
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
    binaryType: "blob" as BinaryType,
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

    it("should accept custom fragment threshold", () => {
      const customAdapter = new WebRtcDataChannelAdapter({
        fragmentThreshold: 50 * 1024,
      })
      expect(customAdapter).toBeInstanceOf(WebRtcDataChannelAdapter)
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

    it("should set binaryType to arraybuffer", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      expect(dataChannel.binaryType).toBe("arraybuffer")
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

  describe("binary message handling", () => {
    it("should decode binary CBOR messages and forward to Loro channel", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Create a binary CBOR message with transport layer prefix
      const msg = {
        type: "channel/establish-request" as const,
        identity: {
          peerId: "67890" as PeerID,
          name: "remote-peer",
          type: "user" as const,
        },
      }
      const frame = encodeFrame(msg)
      const wrapped = wrapCompleteMessage(frame)

      // Simulate binary message event
      const messageEvent = new MessageEvent("message", {
        data: wrapped.buffer,
      })
      ;(dataChannel as any)._emit("message", messageEvent)

      // onChannelReceive should have been called
      expect(hooks.onChannelReceive).toHaveBeenCalled()
    })

    it("should send binary CBOR messages with transport prefix", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Get the channel and send a message
      const channel = [...adapter.channels][0]
      expect(channel).toBeDefined()

      const msg = {
        type: "channel/establish-request" as const,
        identity: {
          peerId: "0" as PeerID,
          name: "test-peer",
          type: "user" as const,
        },
      }

      channel.send(msg)

      // Should have called send with binary data
      expect(dataChannel.send).toHaveBeenCalled()
      const sentData = (dataChannel.send as any).mock.calls[0][0]
      expect(sentData).toBeInstanceOf(Uint8Array)

      // Verify the data has transport layer prefix
      const parsed = parseTransportPayload(sentData)
      expect(parsed.kind).toBe("message")

      // Verify we can decode the frame
      if (parsed.kind === "message") {
        const decoded = decodeFrame(parsed.data)
        expect(decoded).toHaveLength(1)
        expect(decoded[0].type).toBe("channel/establish-request")
      }
    })

    it("should ignore unexpected string messages", async () => {
      const hooks = await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      // Simulate string message event (legacy format - should be ignored)
      const messageEvent = new MessageEvent("message", {
        data: JSON.stringify({ type: "channel/establish-request" }),
      })
      ;(dataChannel as any)._emit("message", messageEvent)

      // onChannelReceive should NOT have been called
      expect(hooks.onChannelReceive).not.toHaveBeenCalled()
    })
  })

  describe("fragmentation", () => {
    it("should fragment large payloads", async () => {
      // Use a small threshold for testing
      const smallThresholdAdapter = new WebRtcDataChannelAdapter({
        fragmentThreshold: 100,
      })
      await initializeAdapter(smallThresholdAdapter)

      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      smallThresholdAdapter.attachDataChannel(peerId, dataChannel)

      // Get the channel
      const channel = [...smallThresholdAdapter.channels][0]
      expect(channel).toBeDefined()

      // Create a message that will result in a large frame
      // We'll use a sync-response with a large payload
      const largeData = new Uint8Array(500)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const msg = {
        type: "channel/sync-response" as const,
        docId: "test-doc",
        transmission: {
          type: "snapshot" as const,
          data: largeData,
          version: { encode: () => new Uint8Array([1, 2, 3]) } as any,
        },
      }

      channel.send(msg)

      // Should have called send multiple times (fragments)
      expect((dataChannel.send as any).mock.calls.length).toBeGreaterThan(1)

      // First call should be fragment header (0x01 prefix)
      const firstSent = (dataChannel.send as any).mock.calls[0][0]
      expect(firstSent[0]).toBe(0x01) // FRAGMENT_HEADER

      // Subsequent calls should be fragment data (0x02 prefix)
      const secondSent = (dataChannel.send as any).mock.calls[1][0]
      expect(secondSent[0]).toBe(0x02) // FRAGMENT_DATA

      await smallThresholdAdapter._stop()
    })

    it("should not fragment small payloads", async () => {
      await initializeAdapter(adapter)
      const peerId = "12345" as PeerID
      const dataChannel = createMockDataChannel("open")

      adapter.attachDataChannel(peerId, dataChannel)

      const channel = [...adapter.channels][0]
      expect(channel).toBeDefined()

      // Small message that won't need fragmentation
      const msg = {
        type: "channel/directory-request" as const,
        docIds: undefined,
      }

      channel.send(msg)

      // Should have called send exactly once
      expect(dataChannel.send).toHaveBeenCalledTimes(1)

      // Should have MESSAGE_COMPLETE prefix (0x00)
      const sentData = (dataChannel.send as any).mock.calls[0][0]
      expect(sentData[0]).toBe(0x00) // MESSAGE_COMPLETE
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
