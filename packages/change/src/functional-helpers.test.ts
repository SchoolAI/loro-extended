import type { LoroEventBatch } from "loro-crdt"
import {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { ChangeOptions } from "./change-options.js"
import { EXT_SYMBOL, type ExtRefBase, ext } from "./ext.js"
import { change, getTransition, subscribe } from "./functional-helpers.js"
import { value } from "./index.js"
import { loro } from "./loro.js"
import { Shape } from "./shape.js"
import { createTypedDoc, type TypedDoc } from "./typed-doc.js"

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

      const versionBefore = loro(doc).version()

      change(doc, draft => {
        draft.count.increment(1)
        draft.count.increment(2)
        draft.count.increment(3)
      })

      const versionAfter = loro(doc).version()

      // Version should have changed (one commit)
      expect(versionAfter).not.toEqual(versionBefore)
      expect(doc.toJSON().count).toBe(6)
    })
  })

  describe("getLoroDoc()", () => {
    it("should return the underlying LoroDoc", () => {
      const doc = createTypedDoc(schema)
      const loroDoc = loro(doc)

      expect(loroDoc).toBeDefined()
      expect(typeof loroDoc.version).toBe("function")
      expect(typeof loroDoc.subscribe).toBe("function")
    })

    it("should return the same LoroDoc as loro(doc)", () => {
      const doc = createTypedDoc(schema)

      expect(loro(doc)).toBe(loro(doc))
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

  describe("ext(ref).doc", () => {
    it("should return the LoroDoc from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(ext(titleRef).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(ext(countRef).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(ext(itemsRef).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      expect(ext(movableItemsRef).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      // Cast through unknown due to TypeScript overload resolution picking wrong type
      expect((ext(usersRef) as unknown as ExtRefBase).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      expect(ext(profileRef).doc).toBe(loro(doc))
    })

    it("should return the LoroDoc from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(ext(treeRef).doc).toBe(loro(doc))
    })
  })

  describe("loro(ref).container", () => {
    it("should return LoroText from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(loro(titleRef)).toBeInstanceOf(LoroText)
    })

    it("should return LoroCounter from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(loro(countRef)).toBeInstanceOf(LoroCounter)
    })

    it("should return LoroList from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(loro(itemsRef)).toBeInstanceOf(LoroList)
    })

    it("should return LoroMovableList from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      expect(loro(movableItemsRef)).toBeInstanceOf(LoroMovableList)
    })

    it("should return LoroMap from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      expect(loro(usersRef)).toBeInstanceOf(LoroMap)
    })

    it("should return LoroMap from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      expect(loro(profileRef)).toBeInstanceOf(LoroMap)
    })

    it("should return LoroTree from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(loro(treeRef)).toBeInstanceOf(LoroTree)
    })
  })

  describe("loro(ref).subscribe()", () => {
    it("should subscribe to TextRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title
      const callback = vi.fn()

      const unsubscribe = loro(titleRef).subscribe(callback)
      titleRef.insert(0, "Hello")
      loro(doc).commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to CounterRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count
      const callback = vi.fn()

      const unsubscribe = loro(countRef).subscribe(callback)
      countRef.increment(5)
      loro(doc).commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to ListRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items
      const callback = vi.fn()

      const unsubscribe = loro(itemsRef).subscribe(callback)
      itemsRef.push("item1")
      loro(doc).commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to RecordRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users
      const callback = vi.fn()

      const unsubscribe = loro(usersRef).subscribe(callback)
      usersRef.set("alice", { name: "Alice" })
      loro(doc).commit()

      expect(callback).toHaveBeenCalled()
      unsubscribe()
    })

    it("should subscribe to TreeRef changes", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree
      const callback = vi.fn()

      const unsubscribe = loro(treeRef).subscribe(callback)
      treeRef.createNode()
      loro(doc).commit()

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
      loro(doc).commit()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("subscribe(ref) for imported (remote) changes", () => {
    it("should fire TextRef subscription when changes are imported", () => {
      // Create two documents - simulating two clients
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      // Set up subscription on doc2's title ref
      const callback = vi.fn()
      const unsubscribe = subscribe(doc2.title, callback)

      // Make changes on doc1
      doc1.title.insert(0, "Hello from doc1")
      loro(doc1).commit()

      // Export from doc1 and import into doc2 (simulating sync)
      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

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
      const unsubscribe = subscribe(doc2.count, callback)

      doc1.count.increment(42)
      loro(doc1).commit()

      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

      expect(callback).toHaveBeenCalled()
      expect(doc2.count.value).toBe(42)

      unsubscribe()
    })

    it("should fire ListRef subscription when changes are imported", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      const callback = vi.fn()
      const unsubscribe = subscribe(doc2.items, callback)

      doc1.items.push("item1")
      doc1.items.push("item2")
      loro(doc1).commit()

      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

      expect(callback).toHaveBeenCalled()
      expect(doc2.items.toJSON()).toEqual(["item1", "item2"])

      unsubscribe()
    })

    it("should fire doc-level subscription when changes are imported", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      const callback = vi.fn()
      const unsubscribe = loro(doc2).subscribe(callback)

      doc1.title.insert(0, "Hello")
      loro(doc1).commit()

      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

      expect(callback).toHaveBeenCalled()

      unsubscribe()
    })

    it("should NOT fire subscription for containers that were not changed", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      // Subscribe to count, but only change title
      const countCallback = vi.fn()
      const unsubscribe = subscribe(doc2.count, countCallback)

      doc1.title.insert(0, "Hello")
      loro(doc1).commit()

      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

      // Count subscription should NOT have fired since count wasn't changed
      expect(countCallback).not.toHaveBeenCalled()

      unsubscribe()
    })

    it("should provide updated value in subscription callback", () => {
      const doc1 = createTypedDoc(fullSchema)
      const doc2 = createTypedDoc(fullSchema)

      let capturedValue: string | undefined
      const unsubscribe = subscribe(doc2.title, () => {
        capturedValue = doc2.title.toString()
      })

      doc1.title.insert(0, "Remote text")
      loro(doc1).commit()

      const snapshot = loro(doc1).export({ mode: "snapshot" })
      loro(doc2).import(snapshot)

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
      loro(doc).commit()

      expect(transitions).toEqual([{ beforeCount: 0, afterCount: 2 }])
      unsubscribe()
    })

    it("should return before/after for mergeable nested containers", () => {
      const mergeableSchema = Shape.doc(
        {
          game: Shape.struct({
            players: Shape.record(
              Shape.struct({
                locked: Shape.plain.boolean().placeholder(false),
              }),
            ),
          }),
        },
        { mergeable: true },
      )

      const doc = createTypedDoc(mergeableSchema)

      change(doc, draft => {
        draft.game.players.set("alice", { locked: false })
        draft.game.players.set("bob", { locked: false })
      })

      const transitions: Array<{
        beforeLocked: boolean
        afterLocked: boolean
      }> = []

      const unsubscribe = loro(doc).subscribe(event => {
        const { before, after } = getTransition(doc, event)
        transitions.push({
          beforeLocked: value(before.game.players.get("bob")?.locked) ?? false,
          afterLocked: value(after.game.players.get("bob")?.locked) ?? false,
        })
      })

      change(doc, draft => {
        const bob = draft.game.players.get("bob") as
          | { locked: boolean }
          | undefined
        if (bob) {
          bob.locked = true
        }
      })

      expect(transitions).toEqual([{ beforeLocked: false, afterLocked: true }])
      unsubscribe()
    })

    it("should throw on checkout events", () => {
      const doc = createTypedDoc(schema)
      const frontiers = loro(doc).frontiers()

      doc.count.increment(1)
      loro(doc).commit()

      let checkoutEvent: LoroEventBatch | undefined
      const unsubscribe = loro(doc).subscribe(event => {
        checkoutEvent = event
      })

      loro(doc).checkout(frontiers)

      expect(checkoutEvent).toBeDefined()
      expect(() => getTransition(doc, checkoutEvent as LoroEventBatch)).toThrow(
        "getTransition does not support checkout events",
      )

      unsubscribe()
    })
  })

  describe("ext(ref).doc", () => {
    it("should return LoroDoc from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      expect(ext(titleRef).doc).toBe(loro(doc))
    })

    it("should return LoroDoc from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      expect(ext(countRef).doc).toBe(loro(doc))
    })

    it("should return LoroDoc from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      expect(ext(itemsRef).doc).toBe(loro(doc))
    })

    it("should return LoroDoc from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      expect(ext(treeRef).doc).toBe(loro(doc))
    })
  })

  describe("loro(ref)", () => {
    it("should return LoroText from TextRef", () => {
      const doc = createTypedDoc(fullSchema)
      const titleRef = doc.title

      const container = loro(titleRef)
      expect(container).toBeInstanceOf(LoroText)
    })

    it("should return LoroCounter from CounterRef", () => {
      const doc = createTypedDoc(fullSchema)
      const countRef = doc.count

      const container = loro(countRef)
      expect(container).toBeInstanceOf(LoroCounter)
    })

    it("should return LoroList from ListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const itemsRef = doc.items

      const container = loro(itemsRef)
      expect(container).toBeInstanceOf(LoroList)
    })

    it("should return LoroMovableList from MovableListRef", () => {
      const doc = createTypedDoc(fullSchema)
      const movableItemsRef = doc.movableItems

      const container = loro(movableItemsRef)
      expect(container).toBeInstanceOf(LoroMovableList)
    })

    it("should return LoroMap from RecordRef", () => {
      const doc = createTypedDoc(fullSchema)
      const usersRef = doc.users

      const container = loro(usersRef)
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroMap from StructRef", () => {
      const doc = createTypedDoc(fullSchema)
      const profileRef = doc.profile

      const container = loro(profileRef)
      expect(container).toBeInstanceOf(LoroMap)
    })

    it("should return LoroTree from TreeRef", () => {
      const doc = createTypedDoc(fullSchema)
      const treeRef = doc.tree

      const container = loro(treeRef)
      expect(container).toBeInstanceOf(LoroTree)
    })

    it("should return the same container", () => {
      const doc = createTypedDoc(fullSchema)

      expect(loro(doc.title)).toBe(loro(doc.title))
      expect(loro(doc.count)).toBe(loro(doc.count))
      expect(loro(doc.items)).toBe(loro(doc.items))
      expect(loro(doc.users)).toBe(loro(doc.users))
      expect(loro(doc.tree)).toBe(loro(doc.tree))
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

        change(doc.profile, (draft: typeof doc.profile) => {
          draft.bio.insert(0, "Hello")
          draft.age.increment(25)
        })

        expect(doc.profile.bio.toString()).toBe("Hello")
        expect(doc.profile.age.value).toBe(25)
      })

      it("should return the original ref for chaining", () => {
        const doc = createTypedDoc(fullSchema)

        const result = change(doc.profile, (draft: typeof doc.profile) => {
          draft.bio.insert(0, "Test")
        })

        expect(result).toBe(doc.profile)
      })
    })

    describe("RecordRef", () => {
      it("should batch set operations", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc.users, (draft: typeof doc.users) => {
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

        change(doc.users, (draft: typeof doc.users) => {
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

        const result = change(doc.users, (draft: typeof doc.users) => {
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

    describe("change(doc, fn) helper", () => {
      it("should support change(doc, fn) helper", () => {
        const doc = createTypedDoc(fullSchema)

        change(doc, draft => {
          draft.title.insert(0, "World")
          draft.count.increment(10)
        })

        expect(doc.title.toString()).toBe("World")
        expect(doc.count.value).toBe(10)
      })
    })

    /**
     * TypedDoc [EXT_SYMBOL] Type Tests
     *
     * These tests verify the fix for TypeScript overload resolution failure
     * when TypedDoc types are "flattened" across module boundaries.
     *
     * Root cause: When a type alias like `type IssueDoc = TypedDoc<IssueSchema>`
     * crosses module boundaries, TypeScript may expand it to its structural form,
     * losing the TypedDoc<T> wrapper. This prevents the first change() overload
     * from matching, causing it to fall through to the [EXT_SYMBOL] overload.
     */
    describe("TypedDoc [EXT_SYMBOL] type fix", () => {
      const TestSchema = Shape.doc({
        count: Shape.counter(),
        title: Shape.text(),
      })

      // Helper type to extract draft type from [EXT_SYMBOL].change signature
      // (copied from functional-helpers.ts since it's not exported)
      type ExtractDraft<T> = T extends {
        [EXT_SYMBOL]: {
          change: (
            fn: (draft: infer D) => void,
            options?: ChangeOptions,
          ) => void
        }
      }
        ? D
        : never

      /**
       * TYPE ASSERTION TEST
       * Verifies that TypedDoc<T> now includes [EXT_SYMBOL] in its type.
       * This is a compile-time test - if the type regresses, this file won't compile.
       */
      it("TypedDoc includes [EXT_SYMBOL] in its type (compile-time assertion)", () => {
        // Static assertion helper - causes compile error if T is not true
        type AssertTrue<T extends true> = T

        // Test 1: TypedDoc has [EXT_SYMBOL] property
        type HasExtSymbol = TypedDoc<typeof TestSchema> extends {
          [EXT_SYMBOL]: unknown
        }
          ? true
          : false
        const _assert1: AssertTrue<HasExtSymbol> = true

        // Test 2: The [EXT_SYMBOL] has a change method
        type HasChangeMethod = TypedDoc<typeof TestSchema> extends {
          [EXT_SYMBOL]: { change: (...args: any[]) => any }
        }
          ? true
          : false
        const _assert2: AssertTrue<HasChangeMethod> = true

        // Test 3: Can access [EXT_SYMBOL] on a TypedDoc (type-level)
        type ExtSymbolType = TypedDoc<typeof TestSchema>[typeof EXT_SYMBOL]
        const _assert3: ExtSymbolType = {} as ExtSymbolType // Just needs to compile

        expect(_assert1).toBe(true)
        expect(_assert2).toBe(true)
        expect(_assert3).toBeDefined()
      })

      /**
       * INFERENCE TEST
       * Verifies that ExtractDraft<TypedDoc<T>> correctly yields Mutable<T>.
       * This ensures the fallback overload path works correctly.
       */
      it("ExtractDraft correctly infers draft type from TypedDoc (compile-time assertion)", () => {
        type AssertTrue<T extends true> = T

        // ExtractDraft<TypedDoc<Schema>> should be Mutable<Schema>, not 'never'
        type Draft = ExtractDraft<TypedDoc<typeof TestSchema>>
        type IsNotNever = Draft extends never ? false : true
        const _assert1: AssertTrue<IsNotNever> = true

        // Draft should have the schema's properties
        type HasCount = Draft extends {
          count: { increment: (n: number) => void }
        }
          ? true
          : false
        const _assert2: AssertTrue<HasCount> = true

        expect(_assert1).toBe(true)
        expect(_assert2).toBe(true)
      })

      /**
       * RUNTIME TEST
       * Verifies that change() works correctly at runtime when using TypedDoc.
       */
      it("change() works with TypedDoc passed through function parameters", () => {
        // Simulate the pattern that previously failed
        function mutateDoc(doc: TypedDoc<typeof TestSchema>) {
          change(doc, draft => {
            draft.count.increment(1)
            draft.title.insert(0, "Hello")
          })
        }

        const doc = createTypedDoc(TestSchema)
        mutateDoc(doc)

        expect(doc.toJSON().count).toBe(1)
        expect(doc.toJSON().title).toBe("Hello")
      })

      /**
       * FALLBACK PATH TEST
       * Verifies that even when accessing through EXT_SYMBOL directly,
       * the change method works correctly.
       */
      it("change() works via EXT_SYMBOL fallback path", () => {
        const doc = createTypedDoc(TestSchema)

        // Access through the EXT_SYMBOL path directly
        // This is what happens internally when the first overload fails
        const extNs = doc[EXT_SYMBOL]
        extNs.change(draft => {
          draft.count.increment(5)
        })

        expect(doc.toJSON().count).toBe(5)
      })

      /**
       * TYPE ALIAS TEST
       * Verifies that type aliases work correctly.
       */
      it("change() works with type alias for TypedDoc", () => {
        type MyDoc = TypedDoc<typeof TestSchema>

        function acceptsAlias(doc: MyDoc) {
          change(doc, draft => {
            draft.count.increment(10)
          })
        }

        const doc = createTypedDoc(TestSchema)
        acceptsAlias(doc)

        expect(doc.toJSON().count).toBe(10)
      })
    })
  })

  describe("subscribe()", () => {
    describe("whole document subscription", () => {
      it("should subscribe to all document changes", () => {
        const doc = createTypedDoc(schema)
        const listener = vi.fn()

        const unsubscribe = subscribe(doc, listener)

        change(doc, d => {
          d.title.insert(0, "Hello")
        })

        expect(listener).toHaveBeenCalled()
        expect(listener.mock.calls[0][0]).toHaveProperty("by", "local")

        unsubscribe()
        listener.mockClear()

        change(doc, d => {
          d.title.insert(5, " World")
        })

        expect(listener).not.toHaveBeenCalled()
      })

      it("should handle multiple subscriptions", () => {
        const doc = createTypedDoc(schema)
        const listener1 = vi.fn()
        const listener2 = vi.fn()

        const unsub1 = subscribe(doc, listener1)
        const unsub2 = subscribe(doc, listener2)

        change(doc, d => {
          d.title.insert(0, "Test")
        })

        expect(listener1).toHaveBeenCalled()
        expect(listener2).toHaveBeenCalled()

        unsub1()
        unsub2()
      })
    })

    describe("path-selector subscription", () => {
      it("should subscribe to path with correct type", () => {
        const DocSchema = Shape.doc(
          {
            config: Shape.struct({ theme: Shape.plain.string() }),
          },
          { mergeable: false },
        )
        const doc = createTypedDoc(DocSchema)
        let receivedValue: string | undefined

        subscribe(
          doc,
          p => p.config.theme,
          value => {
            receivedValue = value
          },
        )

        change(doc, d => {
          d.config.theme = "dark"
        })

        expect(receivedValue).toBe("dark")
      })

      it("should return array for wildcard paths", () => {
        const DocSchema = Shape.doc(
          {
            books: Shape.list(Shape.struct({ title: Shape.text() })),
          },
          { mergeable: false },
        )
        const doc = createTypedDoc(DocSchema)
        let titles: string[] = []

        subscribe(
          doc,
          p => p.books.$each.title,
          value => {
            titles = value
          },
        )

        change(doc, d => {
          d.books.push({ title: "Book 1" })
          d.books.push({ title: "Book 2" })
        })

        expect(titles).toEqual(["Book 1", "Book 2"])
      })

      it("should not fire callback when value unchanged", () => {
        const DocSchema = Shape.doc(
          {
            config: Shape.struct({ theme: Shape.plain.string() }),
            title: Shape.text(),
          },
          { mergeable: false },
        )
        const doc = createTypedDoc(DocSchema)
        const listener = vi.fn()

        change(doc, d => {
          d.config.theme = "light"
        })

        subscribe(doc, p => p.config.theme, listener)

        // Change something else
        change(doc, d => {
          d.title.insert(0, "Hello")
        })

        // Should not fire because config.theme didn't change
        expect(listener).not.toHaveBeenCalled()
      })
    })

    describe("ref subscription", () => {
      it("should subscribe to ref container changes only", () => {
        const doc = createTypedDoc(fullSchema)
        const titleListener = vi.fn()
        const countListener = vi.fn()

        const unsubTitle = subscribe(doc.title, titleListener)
        const unsubCount = subscribe(doc.count, countListener)

        change(doc, d => {
          d.title.insert(0, "Hello")
        })

        expect(titleListener).toHaveBeenCalled()
        expect(countListener).not.toHaveBeenCalled()

        titleListener.mockClear()
        countListener.mockClear()

        change(doc, d => {
          d.count.increment(5)
        })

        expect(titleListener).not.toHaveBeenCalled()
        expect(countListener).toHaveBeenCalled()

        unsubTitle()
        unsubCount()
      })

      it("should work with list refs", () => {
        const doc = createTypedDoc(fullSchema)
        const listener = vi.fn()

        const unsubscribe = subscribe(doc.items, listener)

        change(doc, d => {
          d.items.push("item1")
        })

        expect(listener).toHaveBeenCalled()

        unsubscribe()
      })

      it("should work with struct refs", () => {
        const doc = createTypedDoc(fullSchema)
        const listener = vi.fn()

        const unsubscribe = subscribe(doc.profile, listener)

        change(doc, d => {
          d.profile.bio.insert(0, "My bio")
        })

        expect(listener).toHaveBeenCalled()

        unsubscribe()
      })
    })

    describe("unsubscribe cleanup", () => {
      it("should clean up when unsubscribed", () => {
        const doc = createTypedDoc(schema)
        const listener = vi.fn()

        const unsubscribe = subscribe(doc, listener)

        change(doc, d => {
          d.title.insert(0, "First")
        })
        expect(listener).toHaveBeenCalledTimes(1)

        unsubscribe()
        listener.mockClear()

        change(doc, d => {
          d.title.insert(5, " Second")
        })
        expect(listener).not.toHaveBeenCalled()
      })

      it("should handle multiple unsubscribe calls gracefully", () => {
        const doc = createTypedDoc(schema)
        const listener = vi.fn()

        const unsubscribe = subscribe(doc, listener)

        unsubscribe()
        expect(() => unsubscribe()).not.toThrow()
      })
    })
  })
})
