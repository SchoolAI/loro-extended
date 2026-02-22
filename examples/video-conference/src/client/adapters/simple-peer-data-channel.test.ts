import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type ErrorEventWithError,
  SimplePeerDataChannelWrapper,
} from "./simple-peer-data-channel"

// Mock simple-peer instance
interface MockPeer {
  connected: boolean
  _events: Record<string, Array<(...args: unknown[]) => void>>
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
}

function createMockPeer(): MockPeer {
  const events: Record<string, Array<(...args: unknown[]) => void>> = {}

  const peer: MockPeer = {
    connected: false,
    _events: events,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!events[event]) {
        events[event] = []
      }
      events[event].push(handler)
      return peer
    }),
    send: vi.fn(),
    destroy: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      const handlers = events[event] || []
      for (const h of handlers) {
        h(...args)
      }
    },
  }

  return peer
}

describe("SimplePeerDataChannelWrapper", () => {
  let mockPeer: MockPeer
  let wrapper: SimplePeerDataChannelWrapper

  beforeEach(() => {
    mockPeer = createMockPeer()
    wrapper = new SimplePeerDataChannelWrapper(
      mockPeer as unknown as import("simple-peer").Instance,
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("event forwarding", () => {
    it("forwards peer 'connect' as RTCDataChannel 'open' event", () => {
      const onopen = vi.fn()
      wrapper.onopen = onopen

      mockPeer.emit("connect")

      expect(onopen).toHaveBeenCalledTimes(1)
      expect(onopen.mock.calls[0][0].type).toBe("open")
    })

    it("forwards peer 'close' as RTCDataChannel 'close' event", () => {
      const onclose = vi.fn()
      wrapper.onclose = onclose

      mockPeer.emit("close")

      expect(onclose).toHaveBeenCalledTimes(1)
      expect(onclose.mock.calls[0][0].type).toBe("close")
    })

    it("forwards peer 'error' with error object attached", () => {
      const onerror = vi.fn()
      wrapper.onerror = onerror
      const testError = new Error("connection failed")

      mockPeer.emit("error", testError)

      expect(onerror).toHaveBeenCalledTimes(1)
      const event = onerror.mock.calls[0][0] as ErrorEventWithError
      expect(event.type).toBe("error")
      expect(event.error).toBe(testError)
    })

    it("forwards peer 'data' as RTCDataChannel 'message' event with data payload", () => {
      const onmessage = vi.fn()
      wrapper.onmessage = onmessage
      const testData = new Uint8Array([1, 2, 3])

      mockPeer.emit("data", testData)

      expect(onmessage).toHaveBeenCalledTimes(1)
      expect(onmessage.mock.calls[0][0].data).toBe(testData)
    })
  })

  describe("send", () => {
    it("delegates to peer.send", () => {
      const data = new Uint8Array([1, 2, 3, 4])

      wrapper.send(data)

      expect(mockPeer.send).toHaveBeenCalledWith(data)
    })
  })

  describe("readyState", () => {
    it("returns 'connecting' when peer is not connected", () => {
      mockPeer.connected = false
      expect(wrapper.readyState).toBe("connecting")
    })

    it("returns 'open' when peer is connected", () => {
      mockPeer.connected = true
      expect(wrapper.readyState).toBe("open")
    })
  })

  describe("close", () => {
    it("does NOT destroy peer (lifecycle managed externally)", () => {
      wrapper.close()

      expect(mockPeer.destroy).not.toHaveBeenCalled()
    })
  })

  describe("addEventListener / removeEventListener", () => {
    it("sets and clears event handlers", () => {
      const handler = vi.fn()

      wrapper.addEventListener("open", handler)
      expect(wrapper.onopen).toBe(handler)

      wrapper.removeEventListener("open", handler)
      expect(wrapper.onopen).toBeNull()
    })
  })
})
