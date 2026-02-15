/**
 * Tests for the loro() escape hatch function (returns native Loro types directly)
 * and ext() function for loro-extended features.
 */

import { LoroCounter, LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change, createTypedDoc, ext, loro, Shape } from "./index.js"

describe("loro() function", () => {
  describe("with TypedDoc", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
      items: Shape.list(Shape.plain.string()),
      settings: Shape.struct({
        darkMode: Shape.plain.boolean().placeholder(false),
      }),
    })

    it("should return the underlying LoroDoc directly", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc)
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should allow calling LoroDoc methods directly", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc)
      expect(loroDoc.frontiers()).toBeDefined()
      expect(loroDoc.peerId).toBeDefined()
    })

    it("should subscribe to doc-level changes via LoroDoc", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc).subscribe(event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })

  describe("with TextRef", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    it("should return the underlying LoroText directly", () => {
      const doc = createTypedDoc(schema)

      const loroText = loro(doc.title)
      expect(loroText).toBeInstanceOf(LoroText)
    })

    it("should allow calling LoroText methods directly", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")

      const loroText = loro(doc.title)
      expect(loroText.length).toBe(5)
      expect(loroText.toString()).toBe("Hello")
    })

    it("should subscribe to text changes via LoroText", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.title).subscribe(event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })

  describe("with CounterRef", () => {
    const schema = Shape.doc({
      count: Shape.counter(),
    })

    it("should return the underlying LoroCounter directly", () => {
      const doc = createTypedDoc(schema)

      const loroCounter = loro(doc.count)
      expect(loroCounter).toBeInstanceOf(LoroCounter)
    })

    it("should allow calling LoroCounter methods directly", () => {
      const doc = createTypedDoc(schema)
      doc.count.increment(5)

      const loroCounter = loro(doc.count)
      expect(loroCounter.value).toBe(5)
    })

    it("should subscribe to counter changes via LoroCounter", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.count).subscribe((event: unknown) => {
        events.push(event)
      })

      doc.count.increment(5)

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })

  describe("with ListRef", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.string()),
    })

    it("should return the underlying LoroList directly", () => {
      const doc = createTypedDoc(schema)

      const loroList = loro(doc.items)
      expect(loroList).toBeInstanceOf(LoroList)
    })

    it("should allow calling LoroList methods directly", () => {
      const doc = createTypedDoc(schema)
      doc.items.push("item1")

      const loroList = loro(doc.items)
      expect(loroList.length).toBe(1)
      expect(loroList.get(0)).toBe("item1")
    })

    it("should subscribe to list changes via LoroList", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.items).subscribe(event => {
        events.push(event)
      })

      doc.items.push("item1")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })

  describe("with StructRef", () => {
    const schema = Shape.doc({
      settings: Shape.struct({
        darkMode: Shape.plain.boolean().placeholder(false),
        fontSize: Shape.plain.number().placeholder(14),
      }),
    })

    it("should return the underlying LoroMap directly", () => {
      const doc = createTypedDoc(schema)

      const loroMap = loro(doc.settings)
      expect(loroMap).toBeInstanceOf(LoroMap)
    })

    it("should allow calling LoroMap methods directly", () => {
      const doc = createTypedDoc(schema)
      change(doc, draft => {
        draft.settings.darkMode = true
      })

      const loroMap = loro(doc.settings)
      expect(loroMap.get("darkMode")).toBe(true)
    })

    it("should subscribe to struct changes via LoroMap", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.settings).subscribe(event => {
        events.push(event)
      })

      // Use change() to ensure the subscription fires
      change(doc, draft => {
        draft.settings.darkMode = true
      })

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })

  describe("with RecordRef", () => {
    const schema = Shape.doc({
      users: Shape.record(
        Shape.struct({
          name: Shape.plain.string().placeholder(""),
        }),
      ),
    })

    it("should return the underlying LoroMap directly", () => {
      const doc = createTypedDoc(schema)

      const loroMap = loro(doc.users)
      expect(loroMap).toBeInstanceOf(LoroMap)
    })

    it("should subscribe to record changes via LoroMap", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.users).subscribe(event => {
        events.push(event)
      })

      change(doc, draft => {
        draft.users.set("alice", { name: "Alice" })
      })

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })
})

describe("ext() function", () => {
  describe("with TypedDoc", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
      items: Shape.list(Shape.plain.string()),
      settings: Shape.struct({
        darkMode: Shape.plain.boolean().placeholder(false),
      }),
    })

    it("should access docShape", () => {
      const doc = createTypedDoc(schema)

      const docShape = ext(doc).docShape
      expect(docShape).toBe(schema)
    })

    it("should access rawValue", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")

      const rawValue = ext(doc).rawValue as Record<string, unknown>
      expect(rawValue).toHaveProperty("title", "Hello")
    })

    it("should apply JSON patches", () => {
      const doc = createTypedDoc(schema)

      // Use add operation for counter since it's a container
      ext(doc).applyPatch([
        { op: "add", path: ["items", 0], value: "test-item" },
      ])

      expect(doc.items.toJSON()).toContain("test-item")
    })

    it("should access mergeable property", () => {
      const doc = createTypedDoc(schema)
      expect(ext(doc).mergeable).toBe(true)

      const nonMergeableDoc = createTypedDoc(schema, { mergeable: false })
      expect(ext(nonMergeableDoc).mergeable).toBe(false)
    })

    it("should subscribe to doc-level changes via ext()", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = ext(doc).subscribe(event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })

    describe("change(doc, fn) helper", () => {
      it("should batch mutations via change(doc, fn)", () => {
        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.title.insert(0, "Hello")
          draft.count.increment(5)
          draft.items.push("item1")
        })

        expect(doc.title.toString()).toBe("Hello")
        expect(doc.count.value).toBe(5)
        expect(doc.items.toJSON()).toEqual(["item1"])
      })

      it("should return the doc for chaining", () => {
        const doc = createTypedDoc(schema)

        const result = change(doc, draft => {
          draft.count.increment(1)
        })

        expect(result).toBe(doc)
      })

      it("should support chained change() calls", () => {
        const doc = createTypedDoc(schema)

        change(
          change(
            change(doc, draft => {
              draft.count.increment(1)
            }),
            draft => {
              draft.count.increment(2)
            },
          ),
          draft => {
            draft.count.increment(3)
          },
        )

        expect(doc.count.value).toBe(6)
      })
    })

    describe("ext(doc).fork() method", () => {
      it("should fork the document", () => {
        const doc = createTypedDoc(schema)
        doc.title.insert(0, "Hello")

        const forked = ext(doc).fork()
        forked.title.update("World")

        expect(doc.title.toString()).toBe("Hello")
        expect(forked.title.toString()).toBe("World")
      })

      it("should preserve peer ID when requested", () => {
        const doc = createTypedDoc(schema)
        const originalPeerId = loro(doc).peerId

        const forked = ext(doc).fork({ preservePeerId: true })
        expect(loro(forked).peerId).toBe(originalPeerId)
      })
    })

    describe("ext(doc).forkAt() method", () => {
      it("should fork at a specific version", () => {
        const doc = createTypedDoc(schema)
        doc.title.insert(0, "Hello")
        const frontiers = loro(doc).frontiers()
        doc.title.update("World")

        const forked = ext(doc).forkAt(frontiers)
        expect(forked.title.toString()).toBe("Hello")
        expect(doc.title.toString()).toBe("World")
      })
    })

    describe("ext(doc).initialize() method", () => {
      it("should initialize the document", () => {
        const doc = createTypedDoc(schema, { skipInitialize: true })
        ext(doc).initialize()
        // Should not throw
      })
    })
  })

  describe("with refs", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      items: Shape.list(Shape.plain.string()),
      settings: Shape.struct({
        darkMode: Shape.plain.boolean().placeholder(false),
      }),
    })

    it("should access doc from TextRef via ext()", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.title).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
      expect(loroDoc).toBe(loro(doc))
    })

    it("should access doc from ListRef via ext()", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.items).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
      expect(loroDoc).toBe(loro(doc))
    })

    it("should access doc from StructRef via ext()", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = ext(doc.settings).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
      expect(loroDoc).toBe(loro(doc))
    })

    it("should subscribe to changes via ext(ref)", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = ext(doc.title).subscribe(event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })
  })
})

describe("container operations via ext()", () => {
  describe("ListRef container operations", () => {
    const schema = Shape.doc({
      items: Shape.list(
        Shape.struct({
          name: Shape.plain.string().placeholder(""),
        }),
      ),
    })

    it("should pushContainer via ext()", () => {
      const doc = createTypedDoc(schema)
      const { LoroMap } = require("loro-crdt")

      const newMap = new LoroMap()
      newMap.set("name", "pushed-via-ext")

      // Use ext() to push a container
      ext(doc.items).pushContainer(newMap)

      expect(doc.items.length).toBe(1)
      expect(doc.items.toJSON()[0].name).toBe("pushed-via-ext")
    })

    it("should insertContainer via ext()", () => {
      const doc = createTypedDoc(schema)
      const { LoroMap } = require("loro-crdt")

      // First add an item normally
      change(doc, draft => {
        draft.items.push({ name: "first" })
      })

      const newMap = new LoroMap()
      newMap.set("name", "inserted-via-ext")

      // Use ext() to insert a container at index 0
      ext(doc.items).insertContainer(0, newMap)

      expect(doc.items.length).toBe(2)
      expect(doc.items.toJSON()[0].name).toBe("inserted-via-ext")
      expect(doc.items.toJSON()[1].name).toBe("first")
    })
  })

  describe("StructRef container operations", () => {
    const schema = Shape.doc({
      settings: Shape.struct({
        nested: Shape.struct({
          value: Shape.plain.number().placeholder(0),
        }),
      }),
    })

    it("should setContainer via ext()", () => {
      // setContainer places a raw Loro container directly inside the parent,
      // which requires hierarchical storage (mergeable: false)
      const doc = createTypedDoc(schema, { mergeable: false })
      const { LoroMap } = require("loro-crdt")

      const newMap = new LoroMap()
      newMap.set("value", 42)

      // Use ext() to set a container
      ext(doc.settings).setContainer("nested", newMap)

      expect(doc.settings.nested.value).toBe(42)
    })
  })

  describe("RecordRef container operations", () => {
    const schema = Shape.doc({
      users: Shape.record(
        Shape.struct({
          name: Shape.plain.string().placeholder(""),
        }),
      ),
    })

    it("should setContainer via ext()", () => {
      // setContainer places a raw Loro container directly inside the parent,
      // which requires hierarchical storage (mergeable: false)
      const doc = createTypedDoc(schema, { mergeable: false })
      const { LoroMap } = require("loro-crdt")

      const newMap = new LoroMap()
      newMap.set("name", "Alice via ext")

      // Use ext() to set a container
      ext(doc.users).setContainer("alice", newMap)

      expect(doc.users.get("alice")?.name).toBe("Alice via ext")
    })
  })
})
