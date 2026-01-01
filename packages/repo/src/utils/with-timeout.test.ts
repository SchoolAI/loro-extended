import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { withTimeout } from "./with-timeout.js"

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("basic functionality", () => {
    it("should resolve when promise resolves before timeout", async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 50)
      })

      const resultPromise = withTimeout(promise, {
        timeoutMs: 100,
        createTimeoutError: () => new Error("Timeout"),
      })

      await vi.advanceTimersByTimeAsync(50)

      const result = await resultPromise
      expect(result).toBe("success")
    })

    it("should reject with timeout error when promise takes too long", async () => {
      vi.useRealTimers() // Use real timers for rejection tests

      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 100)
      })

      await expect(
        withTimeout(promise, {
          timeoutMs: 50,
          createTimeoutError: () => new Error("Custom timeout"),
        }),
      ).rejects.toThrow("Custom timeout")
    })

    it("should reject with original error when promise rejects", async () => {
      vi.useRealTimers() // Use real timers for rejection tests

      const promise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Original error")), 50)
      })

      await expect(
        withTimeout(promise, {
          timeoutMs: 100,
          createTimeoutError: () => new Error("Timeout"),
        }),
      ).rejects.toThrow("Original error")
    })
  })

  describe("timeout = 0 (disabled)", () => {
    it("should wait indefinitely when timeout is 0", async () => {
      let resolved = false
      const promise = new Promise<string>(resolve => {
        setTimeout(() => {
          resolved = true
          resolve("success")
        }, 1000)
      })

      const resultPromise = withTimeout(promise, {
        timeoutMs: 0,
        createTimeoutError: () => new Error("Timeout"),
      }).then(result => {
        expect(result).toBe("success")
      })

      // Advance past what would be a normal timeout
      await vi.advanceTimersByTimeAsync(500)
      expect(resolved).toBe(false)

      // Now let the promise resolve
      await vi.advanceTimersByTimeAsync(500)
      await resultPromise
      expect(resolved).toBe(true)
    })
  })

  describe("AbortSignal support", () => {
    it("should reject immediately if signal is already aborted", async () => {
      const controller = new AbortController()
      controller.abort()

      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 100)
      })

      try {
        await withTimeout(promise, {
          timeoutMs: 200,
          signal: controller.signal,
          createTimeoutError: () => new Error("Timeout"),
        })
        expect.fail("Should have thrown AbortError")
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe("AbortError")
      }
    })

    it("should reject when signal is aborted during wait", async () => {
      vi.useRealTimers() // Use real timers for abort tests

      const controller = new AbortController()

      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 200)
      })

      const resultPromise = withTimeout(promise, {
        timeoutMs: 0, // No timeout, only abort
        signal: controller.signal,
        createTimeoutError: () => new Error("Timeout"),
      })

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50)

      try {
        await resultPromise
        expect.fail("Should have thrown AbortError")
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe("AbortError")
      }
    })

    it("should resolve if promise completes before abort", async () => {
      const controller = new AbortController()

      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 50)
      })

      const resultPromise = withTimeout(promise, {
        timeoutMs: 200,
        signal: controller.signal,
        createTimeoutError: () => new Error("Timeout"),
      })

      await vi.advanceTimersByTimeAsync(50)

      const result = await resultPromise
      expect(result).toBe("success")

      // Aborting after resolution should have no effect
      controller.abort()
    })
  })

  describe("cleanup", () => {
    it("should clear timeout when promise resolves", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")

      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve("success"), 50)
      })

      const resultPromise = withTimeout(promise, {
        timeoutMs: 100,
        createTimeoutError: () => new Error("Timeout"),
      })

      await vi.advanceTimersByTimeAsync(50)
      await resultPromise

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it("should clear timeout when promise rejects", async () => {
      vi.useRealTimers() // Use real timers for rejection tests

      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")

      const promise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Error")), 50)
      })

      await expect(
        withTimeout(promise, {
          timeoutMs: 100,
          createTimeoutError: () => new Error("Timeout"),
        }),
      ).rejects.toThrow("Error")

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })
})
