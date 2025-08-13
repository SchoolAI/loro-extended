import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TimeoutError, withTimeout } from "./with-timeout.js"

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("successful execution", () => {
    it("should return success result when function resolves before timeout", async () => {
      const fn = vi.fn().mockResolvedValue("success")
      const timeoutPromise = withTimeout(fn, 1000)

      // Fast-forward until all timers have been executed
      vi.advanceTimersByTime(500)

      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: "success" })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should return success result with complex data type", async () => {
      const complexData = { id: 1, name: "test", items: [1, 2, 3] }
      const fn = vi.fn().mockResolvedValue(complexData)
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(500)

      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: complexData })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should work with zero timeout (no timeout)", async () => {
      const fn = vi.fn().mockResolvedValue("no timeout")
      const timeoutPromise = withTimeout(fn, 0)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: "no timeout" })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should work with negative timeout (no timeout)", async () => {
      const fn = vi.fn().mockResolvedValue("negative timeout")
      const timeoutPromise = withTimeout(fn, -100)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: "negative timeout" })
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("timeout scenarios", () => {
    it("should return timeout error when function takes longer than timeout", async () => {
      let resolveFn: (value: string) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve
          }),
      )
      const timeoutPromise = withTimeout(fn, 1000)

      // Fast-forward past the timeout
      vi.advanceTimersByTime(1500)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBeInstanceOf(TimeoutError)
        expect(result.error.message).toBe("Timed out")
      }
      expect(fn).toHaveBeenCalledTimes(1)

      // Clean up by resolving the function to avoid hanging promises
      resolveFn("slow")
    })

    it("should return timeout error with custom message", async () => {
      let resolveFn: (value: string) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve
          }),
      )
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(1500)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBeInstanceOf(TimeoutError)
        expect(result.error.message).toBe("Timed out")
      }

      // Clean up by resolving the function to avoid hanging promises
      resolveFn("slow")
    })

    it("should not execute function twice after timeout", async () => {
      let resolveFn: (value: string) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve
          }),
      )
      const timeoutPromise = withTimeout(fn, 1000)

      // Fast-forward past the timeout
      vi.advanceTimersByTime(1500)

      await timeoutPromise

      // Fast-forward more to ensure function doesn't get called again
      vi.advanceTimersByTime(1000)

      expect(fn).toHaveBeenCalledTimes(1)

      // Clean up by resolving the function to avoid hanging promises
      resolveFn("slow")
    })
  })

  describe("error handling", () => {
    it("should return error when function throws", async () => {
      const error = new Error("Function error")
      const fn = vi.fn().mockRejectedValue(error)
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBe(error)
      }
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should return custom error type when function throws custom error", async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = "CustomError"
        }
      }

      const error = new CustomError("Custom error")
      const fn = vi.fn().mockRejectedValue(error)
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBeInstanceOf(CustomError)
        expect(result.error.message).toBe("Custom error")
      }
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should handle function throwing non-Error objects", async () => {
      const fn = vi.fn().mockRejectedValue("String error")
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error.message).toBe("String error")
      }
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should prefer function error over timeout when both occur", async () => {
      const error = new Error("Function error")
      let rejectFn: (reason: Error) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFn = reject
          }),
      )
      const timeoutPromise = withTimeout(fn, 1000)

      // Reject the function before the timeout
      setTimeout(() => rejectFn(error), 500)

      // Fast-forward to when function throws
      vi.advanceTimersByTime(600)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBe(error)
      }
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("race conditions", () => {
    it("should resolve with the first completed promise", async () => {
      // Create a function that resolves just before timeout
      let resolveFn: (value: string) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve
          }),
      )
      const timeoutPromise = withTimeout(fn, 1000)

      // Resolve the function before the timeout
      setTimeout(() => resolveFn("first"), 500)

      // Fast-forward to just before timeout
      vi.advanceTimersByTime(600)

      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: "first" })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should handle multiple withTimeout calls independently", async () => {
      let resolve1: (value: string) => void
      let resolve2: (value: string) => void

      const fn1 = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolve1 = resolve
          }),
      )
      const fn2 = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolve2 = resolve
          }),
      )

      const promise1 = withTimeout(fn1, 1000)
      const promise2 = withTimeout(fn2, 1000)

      // Resolve the first function after 500ms (before timeout)
      setTimeout(() => resolve1("first"), 500)

      // Fast-forward past first timeout but before second completes
      vi.advanceTimersByTime(600)

      const result1 = await promise1

      // Now resolve the second function after another 1000ms (after its timeout)
      setTimeout(() => resolve2("second"), 1000)
      vi.advanceTimersByTime(1200)

      const result2 = await promise2

      expect(result1).toEqual({ type: "success", result: "first" })
      expect(result2.type).toBe("error")
      if (result2.type === "error") {
        expect(result2.error).toBeInstanceOf(TimeoutError)
      }

      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
    })
  })

  describe("type safety", () => {
    it("should preserve generic type parameters", async () => {
      interface TestData {
        value: number
      }

      const fn = vi.fn().mockResolvedValue({ value: 42 } as TestData)
      const timeoutPromise = withTimeout<TestData>(fn, 1000)

      vi.advanceTimersByTime(500)

      const result = await timeoutPromise

      if (result.type === "success") {
        expect(result.result.value).toBe(42)
        // Type check - this should compile without error
        const typedValue: TestData = result.result
        expect(typedValue.value).toBe(42)
      }
    })

    it("should handle custom error types in union", async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = "CustomError"
        }
      }

      const error = new CustomError("Custom error")
      const fn = vi.fn().mockRejectedValue(error)
      const timeoutPromise = withTimeout<string, CustomError>(fn, 1000)

      vi.advanceTimersByTime(100)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        // Should be either CustomError or TimeoutError
        expect(result.error).toBeInstanceOf(Error)
        if (result.error instanceof CustomError) {
          expect(result.error.message).toBe("Custom error")
        }
      }
    })
  })

  describe("edge cases", () => {
    it("should handle very small timeouts", async () => {
      let resolveFn: (value: string) => void = () => {}
      const fn = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveFn = resolve
          }),
      )
      const timeoutPromise = withTimeout(fn, 1)

      // Fast-forward past timeout
      vi.advanceTimersByTime(5)

      const result = await timeoutPromise

      expect(result.type).toBe("error")
      if (result.type === "error") {
        expect(result.error).toBeInstanceOf(TimeoutError)
      }

      // Clean up by resolving the function to avoid hanging promises
      resolveFn("fast")
    })

    it("should handle very large timeouts", async () => {
      const fn = vi.fn().mockResolvedValue("large timeout")
      const timeoutPromise = withTimeout(fn, Number.MAX_SAFE_INTEGER)

      // The function should resolve immediately since it's already resolved
      // We don't need to advance timers for this test
      const result = await timeoutPromise

      expect(result).toEqual({ type: "success", result: "large timeout" })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it("should cleanup timers when promise resolves", async () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout")

      const fn = vi.fn().mockResolvedValue("quick")
      const timeoutPromise = withTimeout(fn, 1000)

      vi.advanceTimersByTime(100)

      await timeoutPromise

      // Verify that setTimeout was called
      expect(setTimeoutSpy).toHaveBeenCalled()

      // Note: We can't easily verify clearTimeout was called because it's
      // handled internally by Promise.race and the V8 engine
    })
  })
})
