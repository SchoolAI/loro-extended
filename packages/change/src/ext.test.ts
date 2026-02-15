/**
 * Explicit API surface tests for the ext() function.
 *
 * The ext() function provides loro-extended-specific features that are not
 * part of the native Loro API. This includes:
 * - Document-level operations: fork, forkAt, shallowForkAt, initialize, applyPatch
 * - Document properties: docShape, rawValue, mergeable
 * - Ref-level operations: doc access
 * - Container operations: pushContainer, insertContainer, setContainer
 */

import { LoroMap } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { ext } from "./ext.js"
import { change, subscribe } from "./functional-helpers.js"
import { loro } from "./loro.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

describe("ext() function", () => {
  describe("ExtDocRef", () => {
    const TestSchema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
      items: Shape.list(Shape.plain.string()),
      data: Shape.struct({
        name: Shape.plain.string(),
        value: Shape.plain.number(),
      }),
    })

    it("fork() creates fork with different peer ID", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")

      const forked = ext(doc).fork()

      // Forked doc should have same content
      expect(forked.title.toString()).toBe("Hello")

      // But different peer ID
      expect(loro(forked).peerId).not.toBe(loro(doc).peerId)
    })

    it("fork({ preservePeerId: true }) preserves peer ID", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")

      const forked = ext(doc).fork({ preservePeerId: true })

      // Forked doc should have same content
      expect(forked.title.toString()).toBe("Hello")

      // And same peer ID
      expect(loro(forked).peerId).toBe(loro(doc).peerId)
    })

    it("forkAt() forks at specific version", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")
      const frontiers = loro(doc).frontiers()

      // Make more changes
      doc.title.insert(5, " World")

      // Fork at the earlier version
      const forked = ext(doc).forkAt(frontiers)

      // Forked doc should have content from that version
      expect(forked.title.toString()).toBe("Hello")
    })

    it("shallowForkAt() creates shallow fork", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")
      const frontiers = loro(doc).frontiers()

      // Create shallow fork
      const shallowDoc = ext(doc).shallowForkAt(frontiers)

      // Should have same content
      expect(shallowDoc.title.toString()).toBe("Hello")

      // Should be a valid TypedDoc
      expect(ext(shallowDoc).docShape).toBeDefined()
    })

    it("shallowForkAt() with preservePeerId preserves peer ID", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")
      const frontiers = loro(doc).frontiers()

      const shallowDoc = ext(doc).shallowForkAt(frontiers, {
        preservePeerId: true,
      })

      expect(loro(shallowDoc).peerId).toBe(loro(doc).peerId)
    })

    it("initialize() writes metadata", () => {
      const doc = createTypedDoc(TestSchema)

      // Initialize should not throw
      ext(doc).initialize()

      // Calling again should be a no-op
      ext(doc).initialize()
    })

    it("applyPatch() applies JSON patch operations", () => {
      const doc = createTypedDoc(TestSchema)
      change(doc, draft => {
        draft.data.name = "initial"
        draft.data.value = 0
      })

      ext(doc).applyPatch([
        { op: "replace", path: "/data/name", value: "updated" },
        { op: "replace", path: "/data/value", value: 42 },
      ])

      expect(doc.data.name).toBe("updated")
      expect(doc.data.value).toBe(42)
    })

    it("docShape returns the schema", () => {
      const doc = createTypedDoc(TestSchema)

      const shape = ext(doc).docShape

      expect(shape).toBeDefined()
      expect(shape).toBe(TestSchema)
    })

    it("rawValue returns raw CRDT value without placeholders", () => {
      const doc = createTypedDoc(TestSchema)
      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      const raw = ext(doc).rawValue as { title: string; count: number }

      expect(raw.title).toBe("Hello")
      expect(raw.count).toBe(5)
    })

    it("mergeable returns effective mergeable flag", () => {
      const doc = createTypedDoc(TestSchema)

      // Default is true
      expect(ext(doc).mergeable).toBe(true)

      // Create with mergeable: false
      const nonMergeableDoc = createTypedDoc(TestSchema, { mergeable: false })
      expect(ext(nonMergeableDoc).mergeable).toBe(false)
    })

    it("subscribe() subscribes to document changes (standalone function)", () => {
      const doc = createTypedDoc(TestSchema)
      const events: unknown[] = []

      const unsubscribe = subscribe(doc, event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      unsubscribe()
    })
  })

  describe("ExtRefBase", () => {
    it("doc returns LoroDoc from TextRef", () => {
      const schema = Shape.doc({ text: Shape.text() })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.text).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("doc returns LoroDoc from ListRef", () => {
      const schema = Shape.doc({ items: Shape.list(Shape.plain.string()) })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.items).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("doc returns LoroDoc from CounterRef", () => {
      const schema = Shape.doc({ count: Shape.counter() })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.count).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("doc returns LoroDoc from StructRef", () => {
      const schema = Shape.doc({
        data: Shape.struct({ name: Shape.plain.string() }),
      })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.data).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("doc returns LoroDoc from RecordRef", () => {
      const schema = Shape.doc({
        users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
      })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.users).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("doc returns LoroDoc from TreeRef", () => {
      const schema = Shape.doc({
        tree: Shape.tree(Shape.struct({ name: Shape.plain.string() })),
      })
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.tree).doc

      expect(loroDoc).toBe(loro(doc))
    })

    it("subscribe() subscribes to ref changes via subscribe() helper", () => {
      const schema = Shape.doc({ text: Shape.text() })
      const doc = createTypedDoc(schema)
      const callback = vi.fn()

      const unsubscribe = subscribe(doc.text, callback)

      doc.text.insert(0, "Hello")

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe("ExtListRef", () => {
    it("pushContainer() pushes a Loro container", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.struct({ name: Shape.plain.string() })),
      })
      const doc = createTypedDoc(schema)

      change(doc, draft => {
        const container = ext(draft.items).pushContainer(new LoroMap())
        expect(container).toBeDefined()
      })

      expect(doc.items.length).toBe(1)
    })

    it("insertContainer() inserts a Loro container at index", () => {
      const schema = Shape.doc({
        items: Shape.list(Shape.struct({ name: Shape.plain.string() })),
      })
      const doc = createTypedDoc(schema)

      // First add an item
      change(doc, draft => {
        draft.items.push({ name: "first" })
      })

      // Then insert at index 0
      change(doc, draft => {
        const container = ext(draft.items).insertContainer(0, new LoroMap())
        expect(container).toBeDefined()
      })

      expect(doc.items.length).toBe(2)
    })
  })

  describe("ExtMapRef", () => {
    it("setContainer() sets a Loro container on StructRef", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          nested: Shape.struct({ value: Shape.plain.number() }),
        }),
      })
      const doc = createTypedDoc(schema)

      change(doc, draft => {
        const container = ext(draft.data).setContainer("nested", new LoroMap())
        expect(container).toBeDefined()
      })

      // The container should be set
      expect(doc.data.nested).toBeDefined()
    })

    it("setContainer() sets a Loro container on RecordRef", () => {
      const schema = Shape.doc({
        users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
      })
      const doc = createTypedDoc(schema)

      change(doc, draft => {
        const container = ext(draft.users).setContainer("alice", new LoroMap())
        expect(container).toBeDefined()
      })

      // The container should be set
      expect(doc.users.get("alice")).toBeDefined()
    })
  })
})
