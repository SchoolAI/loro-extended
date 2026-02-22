import { describe, expect, it } from "vitest"
import { ext } from "./ext.js"
import { change } from "./functional-helpers.js"
import { createTypedDoc, loro, Shape, value } from "./index.js"

describe("forkAt", () => {
  describe("TypedDoc.forkAt() method", () => {
    it("should fork at a specific version and return correct state", () => {
      const schema = Shape.doc({
        title: Shape.text(),
        count: Shape.counter(),
      })

      const doc = createTypedDoc(schema)
      doc.title.update("Hello")
      doc.count.increment(5)

      // Get frontiers at this point
      const frontiers = loro(doc).frontiers()

      // Make more changes
      doc.title.update("World")
      doc.count.increment(10)

      // Fork at the earlier version
      const forkedDoc = ext(doc).forkAt(frontiers)

      // Forked doc should have the earlier state
      expect(forkedDoc.title.toString()).toBe("Hello")
      expect(forkedDoc.count.value).toBe(5)

      // Original doc should still have the latest state
      expect(doc.title.toString()).toBe("World")
      expect(doc.count.value).toBe(15)
    })

    it("should preserve type safety on forked doc", () => {
      const schema = Shape.doc({
        items: Shape.list(
          Shape.struct({
            name: Shape.text(),
            done: Shape.plain.boolean(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)
      doc.items.push({ name: "Task 1", done: false })

      const frontiers = loro(doc).frontiers()

      doc.items.push({ name: "Task 2", done: true })

      const forkedDoc = ext(doc).forkAt(frontiers)

      // Type safety: forkedDoc.items should have the same type
      expect(forkedDoc.items.length).toBe(1)
      const firstItem = forkedDoc.items[0]
      if (firstItem) {
        expect(firstItem.name.toString()).toBe("Task 1")
        expect(value(firstItem.done)).toBe(false)
      }

      // Can mutate forked doc independently
      forkedDoc.items.push({ name: "Forked Task", done: true })
      expect(forkedDoc.items.length).toBe(2)
      expect(doc.items.length).toBe(2) // Original unchanged
    })

    it("should create independent documents (changes don't affect original)", () => {
      const schema = Shape.doc({
        value: Shape.counter(),
      })

      const doc = createTypedDoc(schema)
      doc.value.increment(10)

      const frontiers = loro(doc).frontiers()
      const forkedDoc = ext(doc).forkAt(frontiers)

      // Mutate forked doc
      forkedDoc.value.increment(100)

      // Original should be unchanged
      expect(doc.value.value).toBe(10)
      expect(forkedDoc.value.value).toBe(110)

      // Mutate original
      doc.value.increment(5)

      // Forked should be unchanged
      expect(doc.value.value).toBe(15)
      expect(forkedDoc.value.value).toBe(110)
    })

    it("should work with complex schemas (maps, trees)", () => {
      const schema = Shape.doc({
        settings: Shape.record(Shape.plain.string()),
        tree: Shape.tree(
          Shape.struct({
            label: Shape.text(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)
      doc.settings.set("theme", "dark")
      const node = doc.tree.createNode({ label: "Root" })

      const frontiers = loro(doc).frontiers()

      doc.settings.set("theme", "light")
      doc.settings.set("lang", "en")
      node.data.label.update("Updated Root")

      const forkedDoc = ext(doc).forkAt(frontiers)

      expect(value(forkedDoc.settings.get("theme"))).toBe("dark")
      // "lang" was not set before the fork, so it should not exist
      // Note: Record returns placeholder value (empty string) for missing keys
      expect(forkedDoc.settings.has("lang")).toBe(false)

      // Tree should have the earlier state
      const forkedRoots = forkedDoc.tree.roots()
      expect(forkedRoots.length).toBe(1)
      expect(forkedRoots[0].data.label.toString()).toBe("Root")
    })

    it("should have different PeerID from original", () => {
      const schema = Shape.doc({
        text: Shape.text(),
      })

      const doc = createTypedDoc(schema)
      doc.text.update("Hello")

      const frontiers = loro(doc).frontiers()
      const forkedDoc = ext(doc).forkAt(frontiers)

      const originalPeerId = loro(doc).peerId
      const forkedPeerId = loro(forkedDoc).peerId

      expect(forkedPeerId).not.toBe(originalPeerId)
    })
  })

  describe("forkAt() functional helper", () => {
    it("should fork at a specific version", () => {
      const schema = Shape.doc({
        title: Shape.text(),
      })

      const doc = createTypedDoc(schema)
      doc.title.update("Hello")

      const frontiers = loro(doc).frontiers()

      doc.title.update("World")

      // Use ext() method
      const forkedDoc = ext(doc).forkAt(frontiers)

      expect(forkedDoc.title.toString()).toBe("Hello")
      expect(doc.title.toString()).toBe("World")
    })

    it("should preserve schema from original doc", () => {
      const schema = Shape.doc({
        count: Shape.counter().placeholder(42),
      })

      const doc = createTypedDoc(schema)
      // Don't increment - should use placeholder

      const frontiers = loro(doc).frontiers()
      const forkedDoc = ext(doc).forkAt(frontiers)

      // Placeholder should be preserved
      expect(forkedDoc.toJSON().count).toBe(42)
    })
  })

  describe("raw LoroDoc.forkAt() access", () => {
    it("should still be accessible via loro() escape hatch", () => {
      const schema = Shape.doc({
        text: Shape.text(),
      })

      const doc = createTypedDoc(schema)
      doc.text.update("Hello")

      const frontiers = loro(doc).frontiers()
      doc.text.update("World")

      // Raw access returns LoroDoc, not TypedDoc
      const rawForkedDoc = loro(doc).forkAt(frontiers)

      // It's a plain LoroDoc - note that raw toJSON() includes internal containers
      // like _loro_extended_meta_ which are filtered out by TypedDoc.toJSON()
      const rawJson = rawForkedDoc.toJSON()
      expect(rawJson.text).toBe("Hello")

      // Can wrap it manually if needed
      const typedForkedDoc = createTypedDoc(schema, { doc: rawForkedDoc })
      expect(typedForkedDoc.text.toString()).toBe("Hello")
    })
  })

  describe("edge cases", () => {
    it("should fork at empty frontiers (initial state)", () => {
      const schema = Shape.doc({
        count: Shape.counter().placeholder(0),
      })

      const doc = createTypedDoc(schema)
      const emptyFrontiers = loro(doc).frontiers()

      doc.count.increment(10)

      const forkedDoc = ext(doc).forkAt(emptyFrontiers)

      // Should be at initial state (placeholder value)
      expect(forkedDoc.count.value).toBe(0)
    })

    it("should fork at current frontiers (same state)", () => {
      const schema = Shape.doc({
        text: Shape.text(),
      })

      const doc = createTypedDoc(schema)
      doc.text.update("Hello")

      const currentFrontiers = loro(doc).frontiers()
      const forkedDoc = ext(doc).forkAt(currentFrontiers)

      expect(forkedDoc.text.toString()).toBe("Hello")
    })

    it("should work with change() on forked doc", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.plain.number()),
      })

      const doc = createTypedDoc(schema)
      doc.items.push(1)
      doc.items.push(2)

      const frontiers = loro(doc).frontiers()
      doc.items.push(3)

      const forkedDoc = ext(doc).forkAt(frontiers)

      // Use change() on forked doc
      change(forkedDoc, draft => {
        draft.items.push(100)
        draft.items.push(200)
      })

      expect(forkedDoc.items.toJSON()).toEqual([1, 2, 100, 200])
      expect(doc.items.toJSON()).toEqual([1, 2, 3])
    })
  })
})
