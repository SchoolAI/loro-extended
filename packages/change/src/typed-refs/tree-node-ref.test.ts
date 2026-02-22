import type { TreeID } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change, createTypedDoc, Shape, value } from "../index.js"

/**
 * Tests for TreeNodeRef.data value updates across multiple change() calls.
 *
 * TreeNodeRef uses StructRef internally for the `.data` property. Outside of
 * change(), value shape properties return PlainValueRef objects that read fresh
 * from the CRDT container on each valueOf() call. Use value() to unwrap them.
 *
 * Inside change(), value shape properties return raw values for ergonomic use
 * in conditions and comparisons.
 */
describe("TreeNodeRef.data value updates across change() calls", () => {
  describe("updating node data properties", () => {
    it("updates value property in node data", () => {
      const Schema = Shape.doc({
        states: Shape.tree(
          Shape.struct({
            name: Shape.plain.string(),
            value: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      // Create a node with initial data
      let nodeId: TreeID | undefined
      change(doc, draft => {
        const node = draft.states.createNode({ name: "initial", value: 100 })
        nodeId = node.id
      })
      if (!nodeId) throw new Error("nodeId should be defined")

      // Read the node data outside of change() — returns PlainValueRef, use value()
      const node = doc.states.getNodeByID(nodeId)
      expect(value(node?.data.name)).toBe("initial")
      expect(value(node?.data.value)).toBe(100)

      // Update the node data in a new change()
      const capturedNodeId = nodeId
      change(doc, draft => {
        const draftNode = draft.states.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.name.set("updated")
          draftNode.data.value.set(999)
        }
      })

      // Read again — PlainValueRef reads fresh from the container, so updates are visible
      expect(value(node?.data.name)).toBe("updated")
      expect(value(node?.data.value)).toBe(999)
    })

    it("handles multiple sequential updates to node data", () => {
      const Schema = Shape.doc({
        tree: Shape.tree(
          Shape.struct({
            count: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      let nodeId: TreeID | undefined
      change(doc, draft => {
        const node = draft.tree.createNode({ count: 0 })
        nodeId = node.id
      })
      if (!nodeId) throw new Error("nodeId should be defined")

      const capturedNodeId = nodeId
      const node = doc.tree.getNodeByID(capturedNodeId)

      // Multiple updates — PlainValueRef always reads fresh from the container
      for (let i = 1; i <= 5; i++) {
        change(doc, draft => {
          const draftNode = draft.tree.getNodeByID(capturedNodeId)
          if (draftNode) {
            draftNode.data.count.set(i)
          }
        })
        expect(value(node?.data.count)).toBe(i)
      }
    })

    it("updates boolean property in node data", () => {
      const Schema = Shape.doc({
        nodes: Shape.tree(
          Shape.struct({
            active: Shape.plain.boolean(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      let nodeId: TreeID | undefined
      change(doc, draft => {
        const node = draft.nodes.createNode({ active: true })
        nodeId = node.id
      })
      if (!nodeId) throw new Error("nodeId should be defined")

      const capturedNodeId = nodeId
      const node = doc.nodes.getNodeByID(capturedNodeId)
      expect(value(node?.data.active)).toBe(true)

      change(doc, draft => {
        const draftNode = draft.nodes.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.active.set(false)
        }
      })

      expect(value(node?.data.active)).toBe(false)
    })
  })

  describe("nested data structures", () => {
    it("updates record inside node data", () => {
      const Schema = Shape.doc({
        states: Shape.tree(
          Shape.struct({
            name: Shape.plain.string(),
            facts: Shape.record(Shape.plain.any()),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      let nodeId: TreeID | undefined
      change(doc, draft => {
        const node = draft.states.createNode({ name: "state1", facts: {} })
        node.data.facts.set("key1", "value1")
        nodeId = node.id
      })
      if (!nodeId) throw new Error("nodeId should be defined")

      const capturedNodeId = nodeId
      const node = doc.states.getNodeByID(capturedNodeId)
      expect(value(node?.data.name)).toBe("state1")
      expect(value(node?.data.facts.get("key1"))).toBe("value1")

      // Update both the plain value and the record
      change(doc, draft => {
        const draftNode = draft.states.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.name.set("state2")
          draftNode.data.facts.set("key1", "updated")
          draftNode.data.facts.set("key2", "new")
        }
      })

      // PlainValueRef reads fresh from the container — all updates are visible
      expect(value(node?.data.name)).toBe("state2")
      expect(value(node?.data.facts.get("key1"))).toBe("updated")
      expect(value(node?.data.facts.get("key2"))).toBe("new")
    })
  })

  describe("child nodes", () => {
    it("updates child node data independently", () => {
      const Schema = Shape.doc({
        tree: Shape.tree(
          Shape.struct({
            label: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      let parentId: TreeID | undefined
      let childId: TreeID | undefined
      change(doc, draft => {
        const parent = draft.tree.createNode({ label: "parent" })
        const child = parent.createNode({ label: "child" })
        parentId = parent.id
        childId = child.id
      })
      if (!parentId || !childId) throw new Error("IDs should be defined")

      const capturedParentId = parentId
      const capturedChildId = childId
      const parentNode = doc.tree.getNodeByID(capturedParentId)
      const childNode = doc.tree.getNodeByID(capturedChildId)

      expect(value(parentNode?.data.label)).toBe("parent")
      expect(value(childNode?.data.label)).toBe("child")

      // Update both nodes
      change(doc, draft => {
        const parent = draft.tree.getNodeByID(capturedParentId)
        const child = draft.tree.getNodeByID(capturedChildId)
        if (parent) {
          parent.data.label.set("parent-updated")
        }
        if (child) {
          child.data.label.set("child-updated")
        }
      })

      // PlainValueRef reads fresh — all updates visible
      expect(value(parentNode?.data.label)).toBe("parent-updated")
      expect(value(childNode?.data.label)).toBe("child-updated")
    })
  })

  describe("toJSON() consistency", () => {
    it("reflects updates in toJSON()", () => {
      const Schema = Shape.doc({
        tree: Shape.tree(
          Shape.struct({
            status: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(Schema)

      change(doc, draft => {
        draft.tree.createNode({ status: "pending" })
      })

      const json1 = doc.toJSON()
      expect(json1.tree[0]?.data.status).toBe("pending")

      change(doc, draft => {
        const node = draft.tree.roots()[0]
        if (node) {
          node.data.status.set("complete")
        }
      })

      // toJSON reads from container, so it should work
      const json2 = doc.toJSON()
      expect(json2.tree[0]?.data.status).toBe("complete")
    })
  })
})
