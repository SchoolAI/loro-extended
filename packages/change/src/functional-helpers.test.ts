import {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { change, getLoroContainer, getLoroDoc } from "./functional-helpers.js"
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
})
