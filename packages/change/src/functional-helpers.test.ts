import {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { LoroEventBatch } from "loro-crdt"
import {
  change,
  getLoroContainer,
  getLoroDoc,
  getTransition,
} from "./functional-helpers.js"
import { loro } from "./loro.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

const schema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  users: Shape.record(
    Shape.plain.struct({
      name: Shape.plain.string(),
    }),
  ),
})

// Extended schema with all container types for comprehensive testing
const fullSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(Shape.plain.string()),
  movableItems: Shape.movableList(Shape.plain.string()),
  users: Shape.record(
    Shape.plain.struct({
      name: Shape.plain.string(),
    }),
  ),
  profile: Shape.struct({
    bio: Shape.text(),
    age: Shape.counter(),
  }),
  tree: Shape.tree(
    Shape.struct({
      name: Shape.text(),
    }),
  ),
})

describe("functional helpers", () => {
  describe("change()", () => {
    it("should batch multiple mutations into a single transaction", () => {
      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.title.insert(0, "Hello")
        draft.count.increment(5)
        draft.users.set("alice", { name: "Alice" })
      })

      expect(doc.toJSON().title).toBe("Hello")
      expect(doc.toJSON().count).toBe(5)
      expect(doc.toJSON().users.alice).toEqual({ name: "Alice" })
    })

    it("should return the doc for chaining", () => {
      const doc = createTypedDoc(schema)

      const result = change(doc, draft => {
        draft.title.insert(0, "Test")
        draft.count.increment(10)
      })

      // change() returns the doc for chaining
      expect(result).toBe(doc)
      expect(result.toJSON().title).toBe("Test")
      expect(result.toJSON().count).toBe(10)
    })

    it("should support chaining mutations", () => {
      const doc = createTypedDoc(schema)

      // Chain mutations after batch
      change(doc, draft => {
        draft.count.increment(5)
      }).count.increment(3)

      expect(doc.toJSON().count).toBe(8)
    })

    it("should support fluent API with toJSON at the end", () => {
      const doc = createTypedDoc(schema)

      // Fluent API: change -> mutate -> toJSON
      const json = change(doc, draft => {
        draft.title.insert(0, "Hello")
      }).toJSON()

      expect(json.title).toBe("Hello")
    })

    it("should commit all changes as one transaction", () => {
      const doc = createTypedDoc(schema)
      const loroDoc = getLoroDoc(doc)

      const versionBefore = loroDoc.version()

      change(doc, draft => {
        draft.count.increment(1)
        draft.count.increment(2)
        draft.count.increment(3)
      })

      const versionAfter = loroDoc.version()

      // Version should have changed (one commit)
      expect(versionAfter).not.toEqual(versionBefore)
      expect(doc.toJSON().count).toBe(6)
    })
  })

  describe("getLoroDoc()", () => {
    it("should return the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)
      const loroDoc = getLoroDoc(doc)

      expect(loroDoc).toBeDefined()
      expect(typeof loroDoc.version).toBe("function")
      expect(typeof loroDoc.subscribe).toBe("function")
    })

    it("should return the same LoroDoc as loro(doc).doc", () => {
      const doc = createTypedDoc(schema)

      expect(getLoroDoc(doc)).toBe(loro(doc).doc)
    })
  })

  describe("doc.toJSON()", () => {
    it("should work directly on the doc", () => {
      const doc = createTypedDoc(schema)

      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      const json = doc.toJSON()

      expect(json.title).toBe("Hello")
      expect(json.count).toBe(5)
    })

    it("should work on refs", () => {
      const doc = createTypedDoc(schema)

      doc.users.set("alice", { name: "Alice" })
      doc.users.set("bob", { name: "Bob" })

      // toJSON on the record ref
      const usersJson = doc.users.toJSON()
      expect(usersJson).toEqual({
        alice: { name: "Alice" },
        bob: { name: "Bob" },
      })

      // toJSON on counter ref
      doc.count.increment(10)
      expect(doc.count.toJSON()).toBe(10)

      // toJSON on text ref
      doc.title.insert(0, "Test")
      expect(doc.title.toJSON()).toBe("Test")
    })

    it("should be equivalent to doc.toJSON()", () => {
      const doc = createTypedDoc(schema)

      doc.title.insert(0, "Hello")
      doc.count.increment(5)

      expect(doc.toJSON()).toEqual(doc.toJSON())
    })
  })

  describe("loro(ref).doc", () => {
    it("should return the LoroDoc from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(loro(titleRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(loro(countRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(loro(itemsRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      expect(loro(movableItemsRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      expect(loro(usersRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      expect(loro(profileRef).doc).toBe(loro(doc).doc)
    })

    it("should return the LoroDoc from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(loro(treeRef).doc).toBe(loro(doc).doc)
    })
  })

  describe("loro(ref).container", () => {
    it("should return LoroText from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(loro(titleRef).container).toBeInstanceOf(LoroText)
    })

    it("should return LoroCounter from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(loro(countRef).container).toBeInstanceOf(LoroCounter)
    })

    it("should return LoroList from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(loro(itemsRef).container).toBeInstanceOf(LoroList)
    })

    it("should return LoroMovableList from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      expect(loro(movableItemsRef).container).toBeInstanceOf(LoroMovableList)
    })

    it("should return LoroMap from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      expect(loro(usersRef).container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroMap from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      expect(loro(profileRef).container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroTree from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(loro(treeRef).container).toBeInstanceOf(LoroTree)
    })
  })

  describe("loro(ref).subscribe()", () => {
    it("should subscribe to TextRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title
      const callback = vi.fn()

      const unsubscribe = loro(titleRef).subscribe(callback)
      titleRef.insert(0, "Hello")
      loro(doc).doc.commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to CounterRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count
      const callback = vi.fn()

      const unsubscribe = loro(countRef).subscribe(callback)
      countRef.increment(5)
      loro(doc).doc.commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to ListRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items
      const callback = vi.fn()

      const unsubscribe = loro(itemsRef).subscribe(callback)
      itemsRef.push("item1")
      loro(doc).doc.commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to RecordRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users
      const callback = vi.fn()

      const unsubscribe = loro(usersRef).subscribe(callback)
      usersRef.set("alice", { name: "Alice" })
      loro(doc).doc.commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to TreeRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree
      const callback = vi.fn()

      const unsubscribe = loro(treeRef).subscribe(callback)
      treeRef.createNode()
      loro(doc).doc.commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should unsubscribe correctly", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title
      const callback = vi.fn()

      const unsubscribe = loro(titleRef).subscribe(callback)
      unsubscribe()

      titleRef.insert(0, "Hello")
      loro(doc).doc.commit()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("loro(ref).subscribe() for imported (remote) changes", () => {
    it("should fire TextRef subscription when changes are imported", () => {
      // Create two documents - simulating two clients
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      // Set up subscription on doc2's title ref
      const callback = vi.fn()
      const unsubscribe = loro(doc2.title).subscribe(callback)

      // Make changes on doc1
      doc1.title.insert(0, "Hello from doc1")
      loro(doc1).doc.commit()

      // Export from doc1 and import into doc2 (simulating sync)
      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      // The subscription should have fired
      expect(callback).toHaveBeenCalled()

      // And the value should be updated
      expect(doc2.title.toString()).toBe("Hello from doc1")

      unsubscribe()
    })

    it("should fire CounterRef subscription when changes are imported", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      const callback = vi.fn()
      const unsubscribe = loro(doc2.count).subscribe(callback)

      doc1.count.increment(42)
      loro(doc1).doc.commit()

      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      expect(callback).toHaveBeenCalled()
      expect(doc2.count.value).toBe(42)

      unsubscribe()
    })

    it("should fire ListRef subscription when changes are imported", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      const callback = vi.fn()
      const unsubscribe = loro(doc2.items).subscribe(callback)

      doc1.items.push("item1")
      doc1.items.push("item2")
      loro(doc1).doc.commit()

      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      expect(callback).toHaveBeenCalled()
      expect(doc2.items.toJSON()).toEqual(["item1", "item2"])

      unsubscribe()
    })

    it("should fire doc-level subscription when changes are imported", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      const callback = vi.fn()
      const unsubscribe = loro(doc2).doc.subscribe(callback)

      doc1.title.insert(0, "Hello")
      loro(doc1).doc.commit()

      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      expect(callback).toHaveBeenCalled()

      unsubscribe()
    })

    it("should NOT fire subscription for containers that were not changed", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      // Subscribe to count, but only change title
      const countCallback = vi.fn()
      const unsubscribe = loro(doc2.count).subscribe(countCallback)

      doc1.title.insert(0, "Hello")
      loro(doc1).doc.commit()

      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      // Count subscription should NOT have fired since count wasn't changed
      expect(countCallback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it("should provide updated value in subscription callback", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      let capturedValue: string | undefined
      const unsubscribe = loro(doc2.title).subscribe(() => {
        capturedValue = doc2.title.toString()
      })

      doc1.title.insert(0, "Remote text")
      loro(doc1).doc.commit()

      const snapshot = loro(doc1).doc.export({ mode: "snapshot" })
      loro(doc2).doc.import(snapshot)

      expect(capturedValue).toBe("Remote text")

      unsubscribe()
    })
  })

  describe("getTransition()", () => {
    it("should return before/after using reverse diff overlay", () => {
      const doc = createTypedDoc(schema)

      const transitions: Array<{ beforeCount: number; afterCount: number }> = []
      const unsubscribe = loro(doc).subscribe(event => {
        const { before, after } = getTransition(doc, event)
        transitions.push({
          beforeCount: before.count.value,
          afterCount: after.count.value,
        })
      })

      doc.count.increment(2)
      loro(doc).doc.commit()

      expect(transitions).toEqual([{ beforeCount: 0, afterCount: 2 }])
      unsubscribe()
    })

    it("should throw on checkout events", () => {
      const doc = createTypedDoc(schema)
      const frontiers = loro(doc).doc.frontiers()

      doc.count.increment(1)
      loro(doc).doc.commit()

      let checkoutEvent: LoroEventBatch | undefined
      const unsubscribe = loro(doc).subscribe(event => {
        checkoutEvent = event
      })

      loro(doc).doc.checkout(frontiers)

      expect(checkoutEvent).toBeDefined()
      expect(() => getTransition(doc, checkoutEvent as LoroEventBatch)).toThrow(
        "getTransition does not support checkout events",
      )

      unsubscribe()
    })
  })

  describe("getLoroDoc() on refs", () => {
    it("should return LoroDoc from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(getLoroDoc(titleRef)).toBe(loro(doc).doc)
    })

    it("should return LoroDoc from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(getLoroDoc(countRef)).toBe(loro(doc).doc)
    })

    it("should return LoroDoc from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(getLoroDoc(itemsRef)).toBe(loro(doc).doc)
    })

    it("should return LoroDoc from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(getLoroDoc(treeRef)).toBe(loro(doc).doc)
    })
  })

  describe("getLoroContainer()", () => {
    it("should return LoroText from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      const container = getLoroContainer(titleRef)
      expect(container).toBeInstanceOf(LoroText)
    })

    it("should return LoroCounter from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      const container = getLoroContainer(countRef)
      expect(container).toBeInstanceOf(LoroCounter)
    })

    it("should return LoroList from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      const container = getLoroContainer(itemsRef)
      expect(container).toBeInstanceOf(LoroList)
    })

    it("should return LoroMovableList from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      const container = getLoroContainer(movableItemsRef)
      expect(container).toBeInstanceOf(LoroMovableList)
    })

    it("should return LoroMap from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      const container = getLoroContainer(usersRef)
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroMap from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      const container = getLoroContainer(profileRef)
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroTree from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      const container = getLoroContainer(treeRef)
      expect(container).toBeInstanceOf(LoroTree)
    })

    it("should return the same container as loro(ref).container", () => {
      const doc = createTypedDoc(fullSchema)

      expect(getLoroContainer(doc.title)).toBe(loro(doc.title).container)
      expect(getLoroContainer(doc.count)).toBe(loro(doc.count).container)
      expect(getLoroContainer(doc.items)).toBe(loro(doc.items).container)
      expect(getLoroContainer(doc.users)).toBe(loro(doc.users).container)
      expect(getLoroContainer(doc.tree)).toBe(loro(doc.tree).container)
    })
  })

  describe("change() on refs", () => {
    describe("ListRef", () => {
      it("should batch push operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.items, draft => {
          draft.push("item1")
          draft.push("item2")
          draft.push("item3")
        })

        expect(doc.items.toJSON()).toEqual(["item1", "item2", "item3"])
      })

      it("should batch delete and push operations", () => {
        const doc = createTypedDoc(fullSchema)

        // Setup initial data
        doc.items.push("a")
        doc.items.push("b")
        doc.items.push("c")

        change(doc.items, draft => {
          draft.delete(1, 1) // Remove "b"
          draft.push("d")
        })

        expect(doc.items.toJSON()).toEqual(["a", "c", "d"])
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.items, draft => {
          draft.push("item1")
        })

        expect(result).toBe(doc.items)
        result.push("item2")
        expect(doc.items.toJSON()).toEqual(["item1", "item2"])
      })

      it("should support find-and-mutate patterns with value shapes", () => {
        const listSchema = Shape.doc({
          items: Shape.list(
            Shape.plain.struct({
              id: Shape.plain.string(),
              count: Shape.plain.number(),
            }),
          ),
        })
        const doc = createTypedDoc(listSchema)

        // Setup initial data
        doc.items.push({ id: "a", count: 0 })
        doc.items.push({ id: "b", count: 0 })

        change(doc.items, draft => {
          const item = draft.find(i => i.id === "b")
          if (item) {
            item.count = 10
          }
        })

        expect(doc.items.toJSON()).toEqual([
          { id: "a", count: 0 },
          { id: "b", count: 10 },
        ])
      })
    })

    describe("TextRef", () => {
      it("should batch insert operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.title, draft => {
          draft.insert(0, "Hello")
          draft.insert(5, " World")
        })

        expect(doc.title.toString()).toBe("Hello World")
      })

      it("should batch insert and delete operations", () => {
        const doc = createTypedDoc(fullSchema)

        doc.title.insert(0, "Hello World")

        change(doc.title, draft => {
          draft.delete(5, 6) // Remove " World"
          draft.insert(5, " Universe")
        })

        expect(doc.title.toString()).toBe("Hello Universe")
      })

      it("should support update operation", () => {
        const doc = createTypedDoc(fullSchema)

        doc.title.insert(0, "Old Text")

        change(doc.title, draft => {
          draft.update("New Text")
        })

        expect(doc.title.toString()).toBe("New Text")
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.title, draft => {
          draft.insert(0, "Hello")
        })

        expect(result).toBe(doc.title)
        result.insert(5, "!")
        expect(doc.title.toString()).toBe("Hello!")
      })
    })

    describe("CounterRef", () => {
      it("should batch increment operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.count, draft => {
          draft.increment(5)
          draft.increment(3)
          draft.increment(2)
        })

        expect(doc.count.value).toBe(10)
      })

      it("should batch increment and decrement operations", () => {
        const doc = createTypedDoc(fullSchema)

        doc.count.increment(10)

        change(doc.count, draft => {
          draft.increment(5)
          draft.decrement(3)
        })

        expect(doc.count.value).toBe(12)
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.count, draft => {
          draft.increment(5)
        })

        expect(result).toBe(doc.count)
        result.increment(3)
        expect(doc.count.value).toBe(8)
      })
    })

    describe("StructRef", () => {
      it("should batch property assignments", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.profile, draft => {
          draft.bio.insert(0, "Hello")
          draft.age.increment(25)
        })

        expect(doc.profile.bio.toString()).toBe("Hello")
        expect(doc.profile.age.value).toBe(25)
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.profile, draft => {
          draft.bio.insert(0, "Test")
        })

        expect(result).toBe(doc.profile)
      })
    })

    describe("RecordRef", () => {
      it("should batch set operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.users, draft => {
          draft.set("alice", { name: "Alice" })
          draft.set("bob", { name: "Bob" })
        })

        expect(doc.users.toJSON()).toEqual({
          alice: { name: "Alice" },
          bob: { name: "Bob" },
        })
      })

      it("should batch set and delete operations", () => {
        const doc = createTypedDoc(fullSchema)

        doc.users.set("alice", { name: "Alice" })
        doc.users.set("bob", { name: "Bob" })

        change(doc.users, draft => {
          draft.delete("alice")
          draft.set("charlie", { name: "Charlie" })
        })

        expect(doc.users.toJSON()).toEqual({
          bob: { name: "Bob" },
          charlie: { name: "Charlie" },
        })
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.users, draft => {
          draft.set("alice", { name: "Alice" })
        })

        expect(result).toBe(doc.users)
      })
    })

    describe("TreeRef", () => {
      it("should batch createNode operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.tree, draft => {
          draft.createNode()
          draft.createNode()
        })

        expect(doc.tree.roots().length).toBe(2)
      })

      it("should batch node creation with initial data", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.tree, draft => {
          const node1 = draft.createNode()
          node1.data.name.insert(0, "Node 1")

          const node2 = draft.createNode()
          node2.data.name.insert(0, "Node 2")
        })

        const roots = doc.tree.roots()
        expect(roots.length).toBe(2)
        expect(roots[0].data.name.toString()).toBe("Node 1")
        expect(roots[1].data.name.toString()).toBe("Node 2")
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.tree, draft => {
          draft.createNode()
        })

        expect(result).toBe(doc.tree)
      })
    })

    describe("MovableListRef", () => {
      it("should batch push operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.movableItems, draft => {
          draft.push("item1")
          draft.push("item2")
        })

        expect(doc.movableItems.toJSON()).toEqual(["item1", "item2"])
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.movableItems, draft => {
          draft.push("item1")
        })

        expect(result).toBe(doc.movableItems)
      })
    })

    describe("nested change() calls", () => {
      it("should handle nested change() calls correctly", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.items, outerDraft => {
          outerDraft.push("outer1")

          // Nested change on a different ref
          change(doc.count, innerDraft => {
            innerDraft.increment(10)
          })

          outerDraft.push("outer2")
        })

        expect(doc.items.toJSON()).toEqual(["outer1", "outer2"])
        expect(doc.count.value).toBe(10)
      })

      it("should handle deeply nested change() calls", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.items, d1 => {
          d1.push("L1")

          change(doc.count, d2 => {
            d2.increment(1)

            change(doc.title, d3 => {
              d3.insert(0, "Deep")
            })

            d2.increment(2)
          })

          d1.push("L1-end")
        })

        expect(doc.items.toJSON()).toEqual(["L1", "L1-end"])
        expect(doc.count.value).toBe(3)
        expect(doc.title.toString()).toBe("Deep")
      })
    })

    describe("encapsulation use case", () => {
      it("should allow passing refs without exposing the doc", () => {
        const doc = createTypedDoc(fullSchema)

        // Simulate a library function that only receives the ref
        function addItems(itemsRef: typeof doc.items) {
          change(itemsRef, draft => {
            draft.push("library-item-1")
            draft.push("library-item-2")
          })
        }

        // User code passes the ref, not the doc
        addItems(doc.items)

        expect(doc.items.toJSON()).toEqual(["library-item-1", "library-item-2"])
      })

      it("should allow passing TreeRef for state machine use case", () => {
        const doc = createTypedDoc(fullSchema)

        // Simulate a state machine library
        function addStates(statesRef: typeof doc.tree) {
          change(statesRef, draft => {
            const idle = draft.createNode()
            idle.data.name.insert(0, "idle")

            const running = draft.createNode()
            running.data.name.insert(0, "running")
          })
        }

        addStates(doc.tree)

        const roots = doc.tree.roots()
        expect(roots.length).toBe(2)
        expect(roots[0].data.name.toString()).toBe("idle")
        expect(roots[1].data.name.toString()).toBe("running")
      })
    })

    describe("regression: doc.change() still works", () => {
      it("should still support doc.change() method", () => {
        const doc = createTypedDoc(fullSchema)

        doc.change(draft => {
          draft.title.insert(0, "Hello")
          draft.count.increment(5)
        })

        expect(doc.title.toString()).toBe("Hello")
        expect(doc.count.value).toBe(5)
      })

      it("should still support change(doc, fn) helper", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc, draft => {
          draft.title.insert(0, "World")
          draft.count.increment(10)
        })

        expect(doc.title.toString()).toBe("World")
        expect(doc.count.value).toBe(10)
      })
    })
  })
})
