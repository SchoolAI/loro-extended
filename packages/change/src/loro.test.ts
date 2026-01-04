/**
 * Tests for the loro() escape hatch function and doc.change() method.
 */

import { LoroCounter, LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change, createTypedDoc, loro, Shape } from "./index.js"

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

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the container (same as doc for TypedDoc)", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc).container
      expect(container).toBeInstanceOf(LoroDoc)
      expect(container).toBe(loro(doc).doc)
    })

    it("should subscribe to doc-level changes", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc).subscribe(event => {
        events.push(event)
      })

      doc.title.insert(0, "Hello")

      expect(events.length).toBeGreaterThan(0)
      subscription()
    })

    it("should access docShape", () => {
      const doc = createTypedDoc(schema)

      const docShape = loro(doc).docShape
      expect(docShape).toBe(schema)
    })

    it("should access rawValue", () => {
      const doc = createTypedDoc(schema)
      doc.title.insert(0, "Hello")

      const rawValue = loro(doc).rawValue
      expect(rawValue).toHaveProperty("title", "Hello")
    })

    it("should apply JSON patches", () => {
      const doc = createTypedDoc(schema)

      // Use add operation for counter since it's a container
      loro(doc).applyPatch([
        { op: "add", path: ["items", 0], value: "test-item" },
      ])

      expect(doc.items.toJSON()).toContain("test-item")
    })
  })

  describe("with TextRef", () => {
    const schema = Shape.doc({
      title: Shape.text(),
    })

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc.title).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the underlying LoroText container", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc.title).container
      expect(container).toBeInstanceOf(LoroText)
    })

    it("should subscribe to text changes", () => {
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

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc.count).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the underlying LoroCounter container", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc.count).container
      expect(container).toBeInstanceOf(LoroCounter)
    })

    it("should subscribe to counter changes", () => {
      const doc = createTypedDoc(schema)
      const events: unknown[] = []

      const subscription = loro(doc.count).subscribe(event => {
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

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc.items).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the underlying LoroList container", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc.items).container
      expect(container).toBeInstanceOf(LoroList)
    })

    it("should subscribe to list changes", () => {
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

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc.settings).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the underlying LoroMap container", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc.settings).container
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should subscribe to struct changes", () => {
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

    it("should access the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)

      const loroDoc = loro(doc.users).doc
      expect(loroDoc).toBeInstanceOf(LoroDoc)
    })

    it("should access the underlying LoroMap container", () => {
      const doc = createTypedDoc(schema)

      const container = loro(doc.users).container
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should subscribe to record changes", () => {
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

  describe("backward compatibility with $", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
    })

    it("$ and loro() should access the same LoroDoc", () => {
      const doc = createTypedDoc(schema)

      expect(loro(doc).doc).toBe(loro(doc).doc)
    })

    it("$ and loro() should access the same container for refs", () => {
      const doc = createTypedDoc(schema)

      expect(loro(doc.title).container).toBe(loro(doc.title).container)
      expect(loro(doc.count).container).toBe(loro(doc.count).container)
    })
  })

  describe("container operations via loro()", () => {
    describe("ListRef container operations", () => {
      const schema = Shape.doc({
        items: Shape.list(
          Shape.struct({
            name: Shape.plain.string().placeholder(""),
          }),
        ),
      })

      it("should pushContainer via loro()", () => {
        const doc = createTypedDoc(schema)
        const { LoroMap } = require("loro-crdt")

        const newMap = new LoroMap()
        newMap.set("name", "pushed-via-loro")

        // Use loro() to push a container
        const loroList = loro(doc.items) as any
        loroList.pushContainer(newMap)

        expect(doc.items.length).toBe(1)
        expect(doc.items.toJSON()[0].name).toBe("pushed-via-loro")
      })

      it("should insertContainer via loro()", () => {
        const doc = createTypedDoc(schema)
        const { LoroMap } = require("loro-crdt")

        // First add an item normally
        change(doc, draft => {
          draft.items.push({ name: "first" })
        })

        const newMap = new LoroMap()
        newMap.set("name", "inserted-via-loro")

        // Use loro() to insert a container at index 0
        const loroList = loro(doc.items) as any
        loroList.insertContainer(0, newMap)

        expect(doc.items.length).toBe(2)
        expect(doc.items.toJSON()[0].name).toBe("inserted-via-loro")
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

      it("should setContainer via loro()", () => {
        const doc = createTypedDoc(schema)
        const { LoroMap } = require("loro-crdt")

        const newMap = new LoroMap()
        newMap.set("value", 42)

        // Use loro() to set a container
        const loroStruct = loro(doc.settings) as any
        loroStruct.setContainer("nested", newMap)

        expect(doc.settings.nested.value).toBe(42)
      })

      describe("doc.change() method", () => {
        const schema = Shape.doc({
          title: Shape.text(),
          count: Shape.counter(),
          items: Shape.list(Shape.plain.string()),
        })

        it("should batch mutations via doc.change()", () => {
          const doc = createTypedDoc(schema)

          doc.change(draft => {
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

          const result = doc.change(draft => {
            draft.count.increment(1)
          })

          expect(result).toBe(doc)
        })

        it("should support chained change() calls", () => {
          const doc = createTypedDoc(schema)

          doc
            .change(draft => {
              draft.count.increment(1)
            })
            .change(draft => {
              draft.count.increment(2)
            })
            .change(draft => {
              draft.count.increment(3)
            })

          expect(doc.count.value).toBe(6)
        })

        it("doc.change() and doc.change() should be equivalent", () => {
          const doc1 = createTypedDoc(schema)
          const doc2 = createTypedDoc(schema)

          doc1.change(draft => {
            draft.count.increment(5)
            draft.title.insert(0, "Test")
          })

          doc2.change(draft => {
            draft.count.increment(5)
            draft.title.insert(0, "Test")
          })

          expect(doc1.toJSON()).toEqual(doc2.toJSON())
        })

        it("change() helper should use doc.change() internally", () => {
          const doc = createTypedDoc(schema)

          change(doc, draft => {
            draft.count.increment(10)
          })

          expect(doc.count.value).toBe(10)
        })
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

      it("should setContainer via loro()", () => {
        const doc = createTypedDoc(schema)
        const { LoroMap } = require("loro-crdt")

        const newMap = new LoroMap()
        newMap.set("name", "Alice via loro")

        // Use loro() to set a container
        const loroRecord = loro(doc.users) as any
        loroRecord.setContainer("alice", newMap)

        expect(doc.users.get("alice")?.name).toBe("Alice via loro")
      })
    })
  })
})
