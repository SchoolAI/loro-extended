import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HeartbeatManager } from "./heartbeat-manager.js"

describe("HeartbeatManager", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("start", () => {
    it("should start the heartbeat timer", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()

      expect(manager.isRunning).toBe(true)
      manager.stop()
    })

    it("should call onHeartbeat at the specified interval", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()

      // No calls immediately
      expect(onHeartbeat).not.toHaveBeenCalled()

      // After one interval
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1)

      // After two intervals
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(2)

      // After three intervals
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(3)

      manager.stop()
    })

    it("should be idempotent - calling start twice does not create multiple timers", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()
      manager.start() // Second call should be no-op

      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1)

      manager.stop()
    })
  })

  describe("stop", () => {
    it("should stop the heartbeat timer", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()
      manager.stop()

      expect(manager.isRunning).toBe(false)
    })

    it("should prevent further heartbeat calls", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1)

      manager.stop()
      vi.advanceTimersByTime(5000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1) // No additional calls
    })

    it("should be idempotent - calling stop twice is safe", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()
      manager.stop()
      manager.stop() // Second call should be no-op

      expect(manager.isRunning).toBe(false)
    })

    it("should be safe to call stop without start", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      // Should not throw
      manager.stop()

      expect(manager.isRunning).toBe(false)
    })
  })

  describe("isRunning", () => {
    it("should return false initially", () => {
      const manager = new HeartbeatManager(1000, () => {})
      expect(manager.isRunning).toBe(false)
    })

    it("should return true after start", () => {
      const manager = new HeartbeatManager(1000, () => {})
      manager.start()
      expect(manager.isRunning).toBe(true)
      manager.stop()
    })

    it("should return false after stop", () => {
      const manager = new HeartbeatManager(1000, () => {})
      manager.start()
      manager.stop()
      expect(manager.isRunning).toBe(false)
    })
  })

  describe("intervalMs", () => {
    it("should return the configured interval", () => {
      const manager = new HeartbeatManager(5000, () => {})
      expect(manager.intervalMs).toBe(5000)
    })
  })

  describe("restart", () => {
    it("should allow restart after stop", () => {
      const onHeartbeat = vi.fn()
      const manager = new HeartbeatManager(1000, onHeartbeat)

      manager.start()
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1)

      manager.stop()
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(1) // No change

      manager.start()
      vi.advanceTimersByTime(1000)
      expect(onHeartbeat).toHaveBeenCalledTimes(2) // Resumed

      manager.stop()
    })
  })
})
