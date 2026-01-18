import { describe, expect, it, vi } from "vitest"
import { createSyncStore } from "./create-sync-store"

describe("createSyncStore", () => {
  describe("basic functionality", () => {
    it("initializes cache with computed value", () => {
      const cacheRef = { current: null as string | null }
      const computeValue = () => "initial"
      const subscribeToSource = vi.fn(() => () => {})

      createSyncStore(computeValue, subscribeToSource, cacheRef)

      expect(cacheRef.current).toBe("initial")
    })

    it("getSnapshot returns cached value", () => {
      const cacheRef = { current: null as string | null }
      const computeValue = vi.fn(() => "value")
      const subscribeToSource = vi.fn(() => () => {})

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)

      // First call initializes
      expect(computeValue).toHaveBeenCalledTimes(1)

      // getSnapshot should return cached value without recomputing
      expect(store.getSnapshot()).toBe("value")
      expect(computeValue).toHaveBeenCalledTimes(1)
    })

    it("subscribe calls subscribeToSource", () => {
      const cacheRef = { current: null as string | null }
      const computeValue = () => "value"
      const unsubscribe = vi.fn()
      const subscribeToSource = vi.fn(() => unsubscribe)

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)
      const onChange = vi.fn()

      const unsub = store.subscribe(onChange)

      expect(subscribeToSource).toHaveBeenCalledTimes(1)
      expect(typeof unsub).toBe("function")
    })

    it("updates cache and calls onChange when source changes", () => {
      const cacheRef = { current: null as string | null }
      let value = "initial"
      const computeValue = () => value
      let sourceCallback: (() => void) | undefined
      const subscribeToSource = (cb: () => void) => {
        sourceCallback = cb
        return () => {}
      }

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)
      const onChange = vi.fn()

      store.subscribe(onChange)

      // Simulate source change
      value = "updated"
      if (sourceCallback) sourceCallback()

      expect(cacheRef.current).toBe("updated")
      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  describe("error handling", () => {
    it("catches errors in computeValue during subscription and keeps previous cache", () => {
      const cacheRef = { current: null as string | null }
      let shouldThrow = false
      const computeValue = () => {
        if (shouldThrow) {
          throw new Error("Computation error")
        }
        return "value"
      }
      let sourceCallback: (() => void) | undefined
      const subscribeToSource = (cb: () => void) => {
        sourceCallback = cb
        return () => {}
      }

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)
      const onChange = vi.fn()

      store.subscribe(onChange)

      // Initial value should be set
      expect(cacheRef.current).toBe("value")

      // Now make computeValue throw
      shouldThrow = true
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      // Trigger source change - should not throw
      expect(() => {
        if (sourceCallback) sourceCallback()
      }).not.toThrow()

      // Cache should still have previous value
      expect(cacheRef.current).toBe("value")

      // onChange should NOT be called since value didn't change
      expect(onChange).not.toHaveBeenCalled()

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        "[createSyncStore] Error computing value:",
        expect.any(Error),
      )

      consoleSpy.mockRestore()
    })

    it("logs errors in development mode", () => {
      const cacheRef = { current: null as string | null }
      let shouldThrow = false
      const computeValue = () => {
        if (shouldThrow) {
          throw new Error("Test error")
        }
        return "value"
      }
      let sourceCallback: (() => void) | undefined
      const subscribeToSource = (cb: () => void) => {
        sourceCallback = cb
        return () => {}
      }

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)

      // Subscribe to trigger the callback setup
      const onChange = vi.fn()
      store.subscribe(onChange)

      shouldThrow = true
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      // Now sourceCallback should be set
      if (sourceCallback) sourceCallback()

      expect(consoleSpy).toHaveBeenCalledTimes(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        "[createSyncStore] Error computing value:",
        expect.objectContaining({ message: "Test error" }),
      )

      consoleSpy.mockRestore()
    })

    it("propagates errors during initial computation (fail fast)", () => {
      const cacheRef = { current: null as string | null }
      const computeValue = () => {
        throw new Error("Initial computation error")
      }
      const subscribeToSource = vi.fn(() => () => {})

      expect(() =>
        createSyncStore(computeValue, subscribeToSource, cacheRef),
      ).toThrow("Initial computation error")
    })

    it("does not break React rendering when subscription errors occur", () => {
      const cacheRef = { current: null as number | null }
      let callCount = 0
      const computeValue = () => {
        callCount++
        if (callCount > 1) {
          throw new Error("Subsequent error")
        }
        return 42
      }
      let sourceCallback: (() => void) | undefined
      const subscribeToSource = (cb: () => void) => {
        sourceCallback = cb
        return () => {}
      }

      const store = createSyncStore(computeValue, subscribeToSource, cacheRef)
      const onChange = vi.fn()

      store.subscribe(onChange)

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      // Multiple errors should not accumulate or cause issues
      if (sourceCallback) {
        sourceCallback()
        sourceCallback()
        sourceCallback()
      }

      // getSnapshot should still work and return the cached value
      expect(store.getSnapshot()).toBe(42)

      // onChange should never have been called since errors occurred
      expect(onChange).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})
