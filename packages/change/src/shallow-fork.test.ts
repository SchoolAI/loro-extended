import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { ext } from "./ext.js"
import { change } from "./functional-helpers.js"
import { createTypedDoc, loro, Shape, value } from "./index.js"

// ═══════════════════════════════════════════════════════════════════════════
// Shallow Fork Tests
// ═══════════════════════════════════════════════════════════════════════════
//
// These tests verify that shallow snapshots can be used for the fork-and-merge
// pattern in LEA. The key insight is that for fork-and-merge, we don't need
// the full document history - just enough to:
// 1. Read current state
// 2. Apply changes
// 3. Export delta and merge back
//
// Shallow snapshots are created with:
//   doc.export({ mode: "shallow-snapshot", frontiers: frontier })
//
// This creates a "garbage-collected" snapshot with:
// - Current state ✅
// - History only since the frontier (not full oplog)

describe("shallow fork", () => {
  describe("raw LoroDoc shallow snapshot", () => {
    it("should create a shallow snapshot and load it", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("root")
      map.set("count", 0)
      map.set("name", "test")
      doc.commit()

      const frontier = doc.frontiers()

      // Export a shallow snapshot
      const shallowBytes = doc.export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })

      // Load the shallow snapshot
      const shallowDoc = LoroDoc.fromSnapshot(shallowBytes)

      // Verify the state is correct
      const shallowMap = shallowDoc.getMap("root")
      expect(shallowMap.get("count")).toBe(0)
      expect(shallowMap.get("name")).toBe("test")
    })

    it("should allow modifications on a shallow doc", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("root")
      map.set("count", 0)
      doc.commit()

      const frontier = doc.frontiers()

      // Create shallow fork
      const shallowBytes = doc.export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })
      const shallowDoc = LoroDoc.fromSnapshot(shallowBytes)

      // Modify the shallow doc
      const shallowMap = shallowDoc.getMap("root")
      shallowMap.set("count", 1)
      shallowDoc.commit()

      // Verify modification worked
      expect(shallowMap.get("count")).toBe(1)

      // Original doc should be unchanged
      expect(map.get("count")).toBe(0)
    })

    it("should merge changes from shallow doc back to original", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("root")
      map.set("count", 0)
      doc.commit()

      const frontier = doc.frontiers()
      const versionBefore = doc.version()

      // Create shallow fork
      const shallowBytes = doc.export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })
      const shallowDoc = LoroDoc.fromSnapshot(shallowBytes)

      // Copy peer ID for consistent frontier progression
      shallowDoc.setPeerId(doc.peerId)

      // Modify the shallow doc
      const shallowMap = shallowDoc.getMap("root")
      shallowMap.set("count", 42)
      shallowDoc.commit()

      // Export the update (delta from the original version)
      const update = shallowDoc.export({ mode: "update", from: versionBefore })

      // Merge back to original
      doc.import(update)

      // Verify the merge worked
      expect(map.get("count")).toBe(42)
    })

    it("should handle multiple changes in shallow doc", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("root")
      map.set("a", 1)
      map.set("b", 2)
      doc.commit()

      const frontier = doc.frontiers()
      const versionBefore = doc.version()

      // Create shallow fork
      const shallowBytes = doc.export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })
      const shallowDoc = LoroDoc.fromSnapshot(shallowBytes)
      shallowDoc.setPeerId(doc.peerId)

      // Make multiple changes
      const shallowMap = shallowDoc.getMap("root")
      shallowMap.set("a", 10)
      shallowMap.set("b", 20)
      shallowMap.set("c", 30)
      shallowDoc.commit()

      // Export and merge
      const update = shallowDoc.export({ mode: "update", from: versionBefore })
      doc.import(update)

      // Verify all changes merged
      expect(map.get("a")).toBe(10)
      expect(map.get("b")).toBe(20)
      expect(map.get("c")).toBe(30)
    })

    it("should be smaller than full fork for docs with history", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("root")

      // Build up some history
      for (let i = 0; i < 100; i++) {
        map.set("count", i)
        doc.commit()
      }

      const frontier = doc.frontiers()

      // Full fork - use native LoroDoc.fork() since this is a raw LoroDoc
      const fullFork = doc.fork()
      fullFork.checkout(frontier)
      const fullBytes = fullFork.export({ mode: "snapshot" })

      // Shallow fork
      const shallowBytes = doc.export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })

      // Shallow should be smaller (no history)
      expect(shallowBytes.length).toBeLessThan(fullBytes.length)

      // But both should have the same current state
      const shallowDoc = LoroDoc.fromSnapshot(shallowBytes)
      expect(shallowDoc.getMap("root").get("count")).toBe(99)
      expect(fullFork.getMap("root").get("count")).toBe(99)
    })
  })

  describe("TypedDoc shallow fork", () => {
    const TestSchema = Shape.doc({
      counter: Shape.counter(),
      data: Shape.struct({
        name: Shape.plain.string().placeholder(""),
        value: Shape.plain.number().placeholder(0),
      }),
    })

    it("should work with TypedDoc for fork-and-merge pattern", () => {
      const doc = createTypedDoc(TestSchema)

      // Set initial state
      doc.counter.increment(5)
      change(doc, draft => {
        draft.data.name = "test"
        draft.data.value = 100
      })

      const frontier = loro(doc).frontiers()
      const versionBefore = loro(doc).version()

      // Create shallow fork using raw API
      const shallowBytes = loro(doc).export({
        mode: "shallow-snapshot",
        frontiers: frontier,
      })
      const shallowLoroDoc = LoroDoc.fromSnapshot(shallowBytes)
      shallowLoroDoc.setPeerId(loro(doc).peerId)

      // Wrap in TypedDoc
      const shallowDoc = createTypedDoc(TestSchema, { doc: shallowLoroDoc })

      // Verify state is correct
      expect(shallowDoc.counter.value).toBe(5)
      expect(value(shallowDoc.data.name)).toBe("test")
      expect(value(shallowDoc.data.value)).toBe(100)

      // Modify the shallow doc
      shallowDoc.counter.increment(10)
      change(shallowDoc, draft => {
        draft.data.name = "modified"
        draft.data.value = 200
      })

      // Export and merge back
      const update = loro(shallowDoc).export({
        mode: "update",
        from: versionBefore,
      })
      loro(doc).import(update)

      // Verify merge worked
      expect(doc.counter.value).toBe(15)
      expect(value(doc.data.name)).toBe("modified")
      expect(value(doc.data.value)).toBe(200)
    })

    it("should work with shallowForkAt helper function", () => {
      const doc = createTypedDoc(TestSchema)

      // Set initial state
      doc.counter.increment(5)
      change(doc, draft => {
        draft.data.name = "test"
        draft.data.value = 100
      })

      const frontier = loro(doc).frontiers()
      const versionBefore = loro(doc).version()

      // Use the ext().shallowForkAt() method with preservePeerId
      const shallowDoc = ext(doc).shallowForkAt(frontier, {
        preservePeerId: true,
      })

      // Verify state is correct
      expect(shallowDoc.counter.value).toBe(5)
      expect(value(shallowDoc.data.name)).toBe("test")
      expect(value(shallowDoc.data.value)).toBe(100)

      // Modify the shallow doc
      shallowDoc.counter.increment(10)
      change(shallowDoc, draft => {
        draft.data.name = "modified"
        draft.data.value = 200
      })

      // Export and merge back
      const update = loro(shallowDoc).export({
        mode: "update",
        from: versionBefore,
      })
      loro(doc).import(update)

      // Verify merge worked
      expect(doc.counter.value).toBe(15)
      expect(value(doc.data.name)).toBe("modified")
      expect(value(doc.data.value)).toBe(200)
    })

    it("should create independent peer ID by default", () => {
      const doc = createTypedDoc(TestSchema)
      doc.counter.increment(1)

      const frontier = loro(doc).frontiers()

      // Without preservePeerId option
      const shallowDoc = ext(doc).shallowForkAt(frontier)

      // Peer IDs should be different
      expect(loro(shallowDoc).peerId).not.toBe(loro(doc).peerId)
    })

    it("should preserve peer ID when option is set", () => {
      const doc = createTypedDoc(TestSchema)
      doc.counter.increment(1)

      const frontier = loro(doc).frontiers()

      // With preservePeerId option
      const shallowDoc = ext(doc).shallowForkAt(frontier, {
        preservePeerId: true,
      })

      // Peer IDs should be the same
      expect(loro(shallowDoc).peerId).toBe(loro(doc).peerId)
    })
  })
})
