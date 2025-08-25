import type { LoroCounter, LoroText } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"

import { type CombinedPatch, CRDT, change, from } from "./index.js"

// Helper to collect patches from multiple change operations
class PatchCollector {
  private patches: CombinedPatch[] = []
  private subscribers: Array<(patches: CombinedPatch[]) => void> = []

  addPatches(patches: CombinedPatch[]): void {
    this.patches.push(...patches)
    this.subscribers.forEach(callback => callback(patches))
  }

  subscribe(callback: (patches: CombinedPatch[]) => void): () => void {
    this.subscribers.push(callback)
    return () => {
      const index = this.subscribers.indexOf(callback)
      if (index > -1) {
        this.subscribers.splice(index, 1)
      }
    }
  }

  getAllPatches(): CombinedPatch[] {
    return [...this.patches]
  }

  replayTo(index: number): void {
    // Mock implementation
    this.patches = this.patches.slice(0, index)
  }

  clear(): void {
    this.patches = []
  }
}

describe("Dual-Mode Proxy with TEA Integration", () => {
  describe("Patch Generation", () => {
    it("should generate mutative patches for POJO operations", () => {
      const doc = from({ name: "Alice", age: 30 })

      const [updatedDoc, patches] = change(doc, d => {
        d.name = "Bob"
        d.age = 31
      }, { enablePatches: true })

      expect(patches.length).toBeGreaterThan(0)
      
      // Should have mutative patches for POJO changes
      const mutativePatches = patches.filter((p: CombinedPatch) => p.op !== "crdt")
      expect(mutativePatches.length).toBeGreaterThan(0)
      
      // Verify the changes were applied
      expect(updatedDoc.toJSON()).toEqual({ name: "Bob", age: 31 })
    })

    it("should generate CRDT patches for counter operations", () => {
      const doc = from({ 
        score: CRDT.Counter(10),
        name: "Player1" 
      })

      const [updatedDoc, patches] = change(doc, d => {
        d.score.increment(5)
        d.score.decrement(2)
        d.name = "Player2" // This should generate a mutative patch
      }, { enablePatches: true })

      // Should have CRDT patches for counter operations
      const crdtPatches = patches.filter((p: CombinedPatch) => p.op === "crdt")
      expect(crdtPatches.length).toBe(2)
      
      const incrementPatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "increment")
      expect(incrementPatch).toBeDefined()
      expect(incrementPatch?.args).toEqual([5])
      expect(incrementPatch?.crdtType).toBe("counter")
      expect(incrementPatch?.path).toEqual(["score"])
      
      const decrementPatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "decrement")
      expect(decrementPatch).toBeDefined()
      expect(decrementPatch?.args).toEqual([2])
      
      // Should also have mutative patches for POJO changes
      const mutativePatches = patches.filter((p: CombinedPatch) => p.op !== "crdt")
      expect(mutativePatches.length).toBeGreaterThan(0)
      
      // Verify the changes were applied
      const result = updatedDoc.toJSON()
      expect(result.name).toBe("Player2")
      expect((updatedDoc.getMap("doc").get("score") as LoroCounter).value).toBe(13) // 10 + 5 - 2
    })

    it("should generate CRDT patches for text operations", () => {
      const doc = from({ 
        title: CRDT.Text("Hello"),
        subtitle: "World" 
      })

      const [updatedDoc, patches] = change(doc, d => {
        d.title.insert(5, " World")
        d.title.delete(0, 5) // Remove "Hello"
        d.subtitle = "Universe" // This should generate a mutative patch
      }, { enablePatches: true })

      // Should have CRDT patches for text operations
      const crdtPatches = patches.filter((p: CombinedPatch) => p.op === "crdt")
      expect(crdtPatches.length).toBe(2)
      
      const insertPatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "insert")
      expect(insertPatch).toBeDefined()
      expect(insertPatch?.args).toEqual([5, " World"])
      expect(insertPatch?.crdtType).toBe("text")
      expect(insertPatch?.path).toEqual(["title"])
      
      const deletePatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "delete")
      expect(deletePatch).toBeDefined()
      expect(deletePatch?.args).toEqual([0, 5])
      
      // Verify the changes were applied
      const result = updatedDoc.toJSON()
      expect(result.subtitle).toBe("Universe")
      expect((updatedDoc.getMap("doc").get("title") as LoroText).toString()).toBe(" World")
    })

    it("should generate patches for nested CRDT operations", () => {
      const doc = from({ 
        user: {
          name: "Alice",
          stats: {
            score: CRDT.Counter(100),
            level: 5
          }
        }
      })

      const [updatedDoc, patches] = change(doc, d => {
        d.user.stats.score.increment(25)
        d.user.stats.level = 6
        d.user.name = "Bob"
      }, { enablePatches: true })

      // Should have CRDT patch for nested counter
      const crdtPatches = patches.filter((p: CombinedPatch) => p.op === "crdt")
      expect(crdtPatches.length).toBe(1)
      
      const incrementPatch = crdtPatches[0]
      expect(incrementPatch.op).toBe("crdt")
      if (incrementPatch.op === "crdt") {
        expect(incrementPatch.method).toBe("increment")
        expect(incrementPatch.path).toEqual(["user", "stats", "score"])
        expect(incrementPatch.args).toEqual([25])
      }
      
      // Should have mutative patches for POJO changes
      const mutativePatches = patches.filter((p: CombinedPatch) => p.op !== "crdt")
      expect(mutativePatches.length).toBeGreaterThan(0)
    })
  })

  describe("Backward Compatibility", () => {
    it("should work without patches (original behavior)", () => {
      const doc = from({ name: "Alice", age: 30 })

      const updatedDoc = change(doc, d => {
        d.name = "Bob"
        d.age = 31
      })

      expect(updatedDoc.toJSON()).toEqual({ name: "Bob", age: 31 })
    })

    it("should maintain CRDT functionality without patches", () => {
      const doc = from({ 
        counter: CRDT.Counter(10),
        text: CRDT.Text("Hello")
      })

      const updatedDoc = change(doc, d => {
        d.counter.increment(5)
        d.text.insert(5, " World")
      })

      const counter = updatedDoc.getMap("doc").get("counter") as LoroCounter
      const text = updatedDoc.getMap("doc").get("text") as LoroText
      
      expect(counter.value).toBe(15)
      expect(text.toString()).toBe("Hello World")
    })
  })

  describe("TEA Integration", () => {
    it("should support patch collection for time-travel debugging", () => {
      const patchCollector = new PatchCollector()
      let doc = from({ name: "Alice" })

      const patchCallback = vi.fn()
      patchCollector.subscribe(patchCallback)

      const [updatedDoc, patches] = change(doc, d => {
        d.name = "Bob"
      }, { enablePatches: true })

      patchCollector.addPatches(patches)

      expect(patchCallback).toHaveBeenCalled()
      const callArgs = patchCallback.mock.calls[0][0]
      expect(Array.isArray(callArgs)).toBe(true)
      expect(callArgs.length).toBeGreaterThan(0)
    })

    it("should support time-travel debugging through patch replay", () => {
      const patchCollector = new PatchCollector()
      let doc = from({ counter: CRDT.Counter(0) })

      // Make several changes
      let result1 = change(doc, d => d.counter.increment(10), { enablePatches: true })
      patchCollector.addPatches(result1[1])
      
      let result2 = change(result1[0], d => d.counter.increment(5), { enablePatches: true })
      patchCollector.addPatches(result2[1])
      
      let result3 = change(result2[0], d => d.counter.decrement(3), { enablePatches: true })
      patchCollector.addPatches(result3[1])

      const allPatches = patchCollector.getAllPatches()
      expect(allPatches.length).toBe(3)

      // Verify all patches are CRDT patches with correct operations
      const crdtPatches = allPatches.filter((p: CombinedPatch) => p.op === "crdt")
      expect(crdtPatches.length).toBe(3)
      
      if (crdtPatches[0].op === "crdt") {
        expect(crdtPatches[0].method).toBe("increment")
        expect(crdtPatches[0].args).toEqual([10])
      }
      if (crdtPatches[1].op === "crdt") {
        expect(crdtPatches[1].method).toBe("increment")
        expect(crdtPatches[1].args).toEqual([5])
      }
      if (crdtPatches[2].op === "crdt") {
        expect(crdtPatches[2].method).toBe("decrement")
        expect(crdtPatches[2].args).toEqual([3])
      }

      // Test replay functionality
      patchCollector.replayTo(2) // Keep only first 2 patches
      expect(patchCollector.getAllPatches().length).toBe(2)
    })

    it("should handle mixed POJO and CRDT operations in single change", () => {
      const doc = from({ 
        name: "Alice",
        score: CRDT.Counter(100),
        description: CRDT.Text("Player"),
        level: 1
      })

      const [updatedDoc, patches] = change(doc, d => {
        d.name = "Bob"           // Mutative patch
        d.score.increment(50)    // CRDT patch
        d.description.insert(6, " One") // CRDT patch
        d.level = 2              // Mutative patch
      }, { enablePatches: true })

      const crdtPatches = patches.filter((p: CombinedPatch) => p.op === "crdt")
      const mutativePatches = patches.filter((p: CombinedPatch) => p.op !== "crdt")

      expect(crdtPatches.length).toBe(2)
      expect(mutativePatches.length).toBeGreaterThan(0)

      // Verify CRDT patches
      const incrementPatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "increment")
      const insertPatch = crdtPatches.find((p: CombinedPatch) => p.op === "crdt" && p.method === "insert")
      
      expect(incrementPatch?.path).toEqual(["score"])
      expect(incrementPatch?.args).toEqual([50])
      expect(insertPatch?.path).toEqual(["description"])
      expect(insertPatch?.args).toEqual([6, " One"])

      // Verify final state
      const result = updatedDoc.toJSON()
      expect(result.name).toBe("Bob")
      expect(result.level).toBe(2)
      expect((updatedDoc.getMap("doc").get("score") as LoroCounter).value).toBe(150)
      expect((updatedDoc.getMap("doc").get("description") as LoroText).toString()).toBe("Player One")
    })
  })

  describe("Performance and Edge Cases", () => {
    it("should handle large numbers of operations efficiently", () => {
      const doc = from({ counter: CRDT.Counter(0) })

      const startTime = Date.now()
      
      const [updatedDoc, patches] = change(doc, d => {
        for (let i = 0; i < 100; i++) {
          d.counter.increment(1)
        }
      }, { enablePatches: true })

      const endTime = Date.now()
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in under 1 second

      expect(patches.length).toBe(100)
      expect((updatedDoc.getMap("doc").get("counter") as LoroCounter).value).toBe(100)
    })

    it("should handle empty changes gracefully", () => {
      const doc = from({ name: "Alice" })

      const [updatedDoc, patches] = change(doc, d => {
        // No operations
      }, { enablePatches: true })

      expect(patches.length).toBe(0)
      expect(updatedDoc.toJSON()).toEqual({ name: "Alice" })
    })

    it("should preserve patch timestamps and ordering", () => {
      const doc = from({ counter: CRDT.Counter(0) })

      const startTime = Date.now()

      const [updatedDoc, patches] = change(doc, d => {
        d.counter.increment(1)
        d.counter.increment(2)
        d.counter.increment(3)
      }, { enablePatches: true })

      expect(patches.length).toBe(3)

      // Check timestamps are reasonable and ordered
      for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]
        if (patch.op === "crdt") {
          expect(patch.timestamp).toBeGreaterThanOrEqual(startTime)
          expect(patch.timestamp).toBeLessThanOrEqual(Date.now())
          
          if (i > 0 && patches[i-1].op === "crdt") {
            const prevPatch = patches[i-1] as any
            expect(patch.timestamp).toBeGreaterThanOrEqual(prevPatch.timestamp)
          }
        }
      }
    })
  })
})