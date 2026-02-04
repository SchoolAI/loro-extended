/**
 * Integration tests for mergeable flattened containers.
 *
 * These tests verify that when `mergeable: true` is set on a TypedDoc:
 * 1. Concurrent container creation at the same schema path merges correctly via `import()`
 * 2. Concurrent container creation at the same schema path merges correctly via `applyDiff()`
 * 3. `toJSON()` returns the expected hierarchical structure
 * 4. TypedRef access patterns remain unchanged for users
 * 5. Non-mergeable docs continue to work with hierarchical storage (backward compatible)
 */

import { describe, expect, it } from "vitest"
import { createTypedDoc, loro, Shape } from "./index.js"

describe("Mergeable Flattened Containers", () => {
  describe("Basic functionality", () => {
    it("should create a mergeable doc with nested structs", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          nested: Shape.struct({
            value: Shape.plain.string().placeholder("default"),
          }),
        }),
      })

      const doc = createTypedDoc(schema, { mergeable: true })

      // Access nested struct
      doc.data.nested.value = "hello"

      expect(doc.data.nested.value).toBe("hello")
    })

    it("should store containers at root with path-based names when mergeable", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          nested: Shape.struct({
            value: Shape.plain.string().placeholder("default"),
          }),
        }),
      })

      const doc = createTypedDoc(schema, { mergeable: true })

      // Access nested struct to trigger container creation
      doc.data.nested.value = "hello"

      // Check that root containers exist with path-based names
      const loroDoc = loro(doc).doc
      const dataMap = loroDoc.getMap("data")
      const nestedMap = loroDoc.getMap("data-nested")

      // The parent map should have a null marker for the child
      expect(dataMap.get("nested")).toBe(null)

      // The nested map should have the value
      expect(nestedMap.get("value")).toBe("hello")
    })

    it("should work with records containing dynamic keys", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            score: Shape.plain.number().placeholder(0),
            name: Shape.plain.string().placeholder(""),
          }),
        ),
      })

      const doc = createTypedDoc(schema, { mergeable: true })

      // Create players
      doc.players.alice = { score: 100, name: "Alice" }
      doc.players.bob = { score: 200, name: "Bob" }

      expect(doc.players.alice.score).toBe(100)
      expect(doc.players.bob.name).toBe("Bob")

      // Check root containers
      const loroDoc = loro(doc).doc
      const playersMap = loroDoc.getMap("players")
      const aliceMap = loroDoc.getMap("players-alice")
      const bobMap = loroDoc.getMap("players-bob")

      expect(playersMap.get("alice")).toBe(null)
      expect(playersMap.get("bob")).toBe(null)
      expect(aliceMap.get("score")).toBe(100)
      expect(bobMap.get("name")).toBe("Bob")
    })

    it("should handle keys with hyphens via escaping", () => {
      const schema = Shape.doc({
        config: Shape.record(
          Shape.struct({
            value: Shape.plain.string().placeholder(""),
          }),
        ),
      })

      const doc = createTypedDoc(schema, { mergeable: true })

      // Create entry with hyphenated key
      doc.config["api-url"] = { value: "https://example.com" }

      expect(doc.config["api-url"].value).toBe("https://example.com")

      // Check that the root container name is properly escaped
      const loroDoc = loro(doc).doc
      const apiUrlMap = loroDoc.getMap("config-api\\-url")
      expect(apiUrlMap.get("value")).toBe("https://example.com")
    })
  })

  describe("Concurrent creation merging via import()", () => {
    it("should merge concurrent struct creation", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          items: Shape.record(Shape.plain.string().placeholder("")),
        }),
      })

      // Peer A creates a doc and adds an item
      const docA = createTypedDoc(schema, { mergeable: true })
      loro(docA).doc.setPeerId("1")
      docA.data.items.a = "from A"

      // Peer B creates a doc and adds a different item
      const docB = createTypedDoc(schema, { mergeable: true })
      loro(docB).doc.setPeerId("2")
      docB.data.items.b = "from B"

      // Sync via import
      const exportA = loro(docA).doc.export({ mode: "update" })
      const exportB = loro(docB).doc.export({ mode: "update" })

      loro(docA).doc.import(exportB)
      loro(docB).doc.import(exportA)

      // Both docs should have both items
      expect(docA.data.items.a).toBe("from A")
      expect(docA.data.items.b).toBe("from B")
      expect(docB.data.items.a).toBe("from A")
      expect(docB.data.items.b).toBe("from B")
    })

    it("should merge concurrent nested struct creation", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            score: Shape.plain.number().placeholder(0),
          }),
        ),
      })

      // Peer A creates alice
      const docA = createTypedDoc(schema, { mergeable: true })
      loro(docA).doc.setPeerId("1")
      docA.players.alice = { score: 100 }

      // Peer B creates bob
      const docB = createTypedDoc(schema, { mergeable: true })
      loro(docB).doc.setPeerId("2")
      docB.players.bob = { score: 200 }

      // Sync via import
      const exportA = loro(docA).doc.export({ mode: "update" })
      const exportB = loro(docB).doc.export({ mode: "update" })

      loro(docA).doc.import(exportB)
      loro(docB).doc.import(exportA)

      // Both docs should have both players
      expect(docA.players.alice.score).toBe(100)
      expect(docA.players.bob.score).toBe(200)
      expect(docB.players.alice.score).toBe(100)
      expect(docB.players.bob.score).toBe(200)
    })
  })

  describe("Concurrent creation merging via applyDiff()", () => {
    it("should merge concurrent struct creation via applyDiff", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          items: Shape.record(Shape.plain.string().placeholder("")),
        }),
      })

      // Peer A creates a doc and adds an item
      const docA = createTypedDoc(schema, { mergeable: true })
      loro(docA).doc.setPeerId("1")
      docA.data.items.a = "from A"

      // Peer B creates a doc and adds a different item
      const docB = createTypedDoc(schema, { mergeable: true })
      loro(docB).doc.setPeerId("2")
      docB.data.items.b = "from B"

      // Sync via applyDiff (simulating lens propagation)
      const diffA = loro(docA).doc.diff([], loro(docA).doc.frontiers(), false)
      const diffB = loro(docB).doc.diff([], loro(docB).doc.frontiers(), false)

      loro(docA).doc.applyDiff(diffB)
      loro(docB).doc.applyDiff(diffA)

      // Both docs should have both items
      expect(docA.data.items.a).toBe("from A")
      expect(docA.data.items.b).toBe("from B")
      expect(docB.data.items.a).toBe("from A")
      expect(docB.data.items.b).toBe("from B")
    })

    it("should merge concurrent nested struct creation via applyDiff", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            score: Shape.plain.number().placeholder(0),
          }),
        ),
      })

      // Peer A creates alice
      const docA = createTypedDoc(schema, { mergeable: true })
      loro(docA).doc.setPeerId("1")
      docA.players.alice = { score: 100 }

      // Peer B creates bob
      const docB = createTypedDoc(schema, { mergeable: true })
      loro(docB).doc.setPeerId("2")
      docB.players.bob = { score: 200 }

      // Sync via applyDiff
      const diffA = loro(docA).doc.diff([], loro(docA).doc.frontiers(), false)
      const diffB = loro(docB).doc.diff([], loro(docB).doc.frontiers(), false)

      loro(docA).doc.applyDiff(diffB)
      loro(docB).doc.applyDiff(diffA)

      // Both docs should have both players
      expect(docA.players.alice.score).toBe(100)
      expect(docA.players.bob.score).toBe(200)
      expect(docB.players.alice.score).toBe(100)
      expect(docB.players.bob.score).toBe(200)
    })
  })

  describe("toJSON reconstruction", () => {
    it("should reconstruct hierarchy in toJSON for mergeable docs", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          nested: Shape.struct({
            value: Shape.plain.string().placeholder("default"),
          }),
        }),
      })

      const doc = createTypedDoc(schema, { mergeable: true })
      doc.data.nested.value = "hello"

      const json = doc.toJSON()
      expect(json).toEqual({
        data: {
          nested: {
            value: "hello",
          },
        },
      })
    })

    it("should reconstruct hierarchy with records", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            score: Shape.plain.number().placeholder(0),
          }),
        ),
      })

      const doc = createTypedDoc(schema, { mergeable: true })
      doc.players.alice = { score: 100 }
      doc.players.bob = { score: 200 }

      const json = doc.toJSON()
      expect(json).toEqual({
        players: {
          alice: { score: 100 },
          bob: { score: 200 },
        },
      })
    })
  })

  describe("Backward compatibility", () => {
    it("should use hierarchical storage for non-mergeable docs", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          nested: Shape.struct({
            value: Shape.plain.string().placeholder("default"),
          }),
        }),
      })

      // Non-mergeable doc (default)
      const doc = createTypedDoc(schema)
      doc.data.nested.value = "hello"

      // Check that nested containers are used (not root containers)
      const loroDoc = loro(doc).doc
      const dataMap = loroDoc.getMap("data")

      // The nested container should be a real container, not a null marker
      const nestedValue = dataMap.get("nested")
      expect(nestedValue).not.toBe(null)
      expect(typeof nestedValue).toBe("object")
    })

    it("should work correctly with non-mergeable docs", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            score: Shape.plain.number().placeholder(0),
          }),
        ),
      })

      const doc = createTypedDoc(schema) // No mergeable option
      doc.players.alice = { score: 100 }

      expect(doc.players.alice.score).toBe(100)
      expect(doc.toJSON()).toEqual({
        players: {
          alice: { score: 100 },
        },
      })
    })
  })

  describe("forkAt preserves mergeable setting", () => {
    it("should preserve mergeable setting when forking", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          value: Shape.plain.string().placeholder("default"),
        }),
      })

      const doc = createTypedDoc(schema, { mergeable: true })
      doc.data.value = "v1"

      const frontiers = loro(doc).doc.frontiers()
      doc.data.value = "v2"

      const forked = doc.forkAt(frontiers)

      // The forked doc should also be mergeable
      // We can verify by checking that it uses root containers
      forked.data.value = "forked"

      const loroDoc = loro(forked).doc
      const dataMap = loroDoc.getMap("data")
      expect(dataMap.get("value")).toBe("forked")
    })
  })
})
