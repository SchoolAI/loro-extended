import { describe, expect, it, vi } from "vitest"
import { WorkQueue } from "./work-queue.js"

describe("WorkQueue", () => {
  describe("basic functionality", () => {
    it("should process enqueued work", () => {
      const results: number[] = []
      const onQuiescent = vi.fn()
      const queue = new WorkQueue(onQuiescent)

      queue.enqueue(() => results.push(1))
      queue.enqueue(() => results.push(2))
      queue.enqueue(() => results.push(3))

      expect(results).toEqual([1, 2, 3])
    })

    it("should call onQuiescent when queue is empty", () => {
      const onQuiescent = vi.fn()
      const queue = new WorkQueue(onQuiescent)

      queue.enqueue(() => {})

      expect(onQuiescent).toHaveBeenCalledTimes(1)
    })

    it("should call onQuiescent after all work is processed", () => {
      const order: string[] = []
      const onQuiescent = () => order.push("quiescent")
      const queue = new WorkQueue(onQuiescent)

      // Each enqueue triggers immediate processing when not already processing
      queue.enqueue(() => order.push("work1"))
      queue.enqueue(() => order.push("work2"))

      // Each enqueue completes its work and calls onQuiescent
      expect(order).toEqual(["work1", "quiescent", "work2", "quiescent"])
    })

    it("should batch work when enqueued during processing", () => {
      const order: string[] = []
      const onQuiescent = () => order.push("quiescent")
      const queue = new WorkQueue(onQuiescent)

      // When work is enqueued during processing, it's batched
      queue.enqueue(() => {
        order.push("work1")
        queue.enqueue(() => order.push("work2"))
      })

      // Only one quiescent call because work2 was enqueued during processing
      expect(order).toEqual(["work1", "work2", "quiescent"])
    })
  })

  describe("isProcessing", () => {
    it("should return false when not processing", () => {
      const queue = new WorkQueue(() => {})

      expect(queue.isProcessing).toBe(false)
    })

    it("should return true during processing", () => {
      let wasProcessing = false
      const queue = new WorkQueue(() => {})

      queue.enqueue(() => {
        wasProcessing = queue.isProcessing
      })

      expect(wasProcessing).toBe(true)
      expect(queue.isProcessing).toBe(false)
    })

    it("should return true during onQuiescent callback", () => {
      let wasProcessingDuringQuiescent = false
      const queue = new WorkQueue(() => {
        wasProcessingDuringQuiescent = queue.isProcessing
      })

      queue.enqueue(() => {})

      // Note: isProcessing is true during onQuiescent because we're still
      // in the try block. This is intentional - it prevents re-entrancy.
      expect(wasProcessingDuringQuiescent).toBe(true)
    })
  })

  describe("recursion prevention", () => {
    it("should handle work enqueued during processing", () => {
      const results: number[] = []
      const onQuiescent = vi.fn()
      const queue = new WorkQueue(onQuiescent)

      queue.enqueue(() => {
        results.push(1)
        // Enqueue more work during processing
        queue.enqueue(() => results.push(2))
        queue.enqueue(() => results.push(3))
      })

      expect(results).toEqual([1, 2, 3])
      // onQuiescent called once at the end, not after each enqueue
      expect(onQuiescent).toHaveBeenCalledTimes(1)
    })

    it("should handle deeply nested enqueues", () => {
      const results: number[] = []
      const onQuiescent = vi.fn()
      const queue = new WorkQueue(onQuiescent)

      queue.enqueue(() => {
        results.push(1)
        queue.enqueue(() => {
          results.push(2)
          queue.enqueue(() => {
            results.push(3)
            queue.enqueue(() => results.push(4))
          })
        })
      })

      expect(results).toEqual([1, 2, 3, 4])
      expect(onQuiescent).toHaveBeenCalledTimes(1)
    })

    it("should handle work enqueued during onQuiescent", () => {
      const results: number[] = []
      let quiescentCount = 0
      const queue = new WorkQueue(() => {
        quiescentCount++
        // First time onQuiescent is called, enqueue more work
        if (quiescentCount === 1) {
          queue.enqueue(() => results.push(2))
        }
      })

      queue.enqueue(() => results.push(1))

      expect(results).toEqual([1, 2])
      // onQuiescent called twice: once after initial work, once after new work
      expect(quiescentCount).toBe(2)
    })
  })

  describe("error handling", () => {
    it("should reset isProcessing even if work throws", () => {
      const queue = new WorkQueue(() => {})

      expect(() => {
        queue.enqueue(() => {
          throw new Error("test error")
        })
      }).toThrow("test error")

      expect(queue.isProcessing).toBe(false)
    })

    it("should continue processing after error in onQuiescent", () => {
      let quiescentCalls = 0
      const queue = new WorkQueue(() => {
        quiescentCalls++
        if (quiescentCalls === 1) {
          throw new Error("quiescent error")
        }
      })

      expect(() => {
        queue.enqueue(() => {})
      }).toThrow("quiescent error")

      expect(queue.isProcessing).toBe(false)

      // Queue should still work after error
      const results: number[] = []
      queue.enqueue(() => results.push(1))
      expect(results).toEqual([1])
    })
  })

  describe("order guarantees", () => {
    it("should process work in FIFO order", () => {
      const results: number[] = []
      const queue = new WorkQueue(() => {})

      // Each enqueue processes immediately when not already processing
      queue.enqueue(() => results.push(1))
      queue.enqueue(() => results.push(2))
      queue.enqueue(() => results.push(3))

      expect(results).toEqual([1, 2, 3])
    })

    it("should maintain FIFO order with nested enqueues", () => {
      const results: string[] = []
      const queue = new WorkQueue(() => {})

      // First enqueue starts processing
      queue.enqueue(() => {
        results.push("a1")
        queue.enqueue(() => results.push("a2"))
      })
      // Second enqueue starts fresh processing (first is done)
      queue.enqueue(() => {
        results.push("b1")
        queue.enqueue(() => results.push("b2"))
      })

      // a1 runs, enqueues a2, a2 runs (nested)
      // b1 runs, enqueues b2, b2 runs (nested)
      expect(results).toEqual(["a1", "a2", "b1", "b2"])
    })

    it("should maintain FIFO order when all work enqueued during processing", () => {
      const results: string[] = []
      const queue = new WorkQueue(() => {})

      // All work enqueued during single processing cycle
      queue.enqueue(() => {
        results.push("a1")
        queue.enqueue(() => results.push("a2"))
        queue.enqueue(() => {
          results.push("b1")
          queue.enqueue(() => results.push("b2"))
        })
      })

      // a1 runs first, enqueues a2 and b1-block
      // a2 runs (FIFO)
      // b1-block runs, enqueues b2
      // b2 runs
      expect(results).toEqual(["a1", "a2", "b1", "b2"])
    })
  })
})
