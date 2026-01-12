import type { TreeID } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change, createTypedDoc, Shape } from "../index.js"

/**
 * Tests for TreeNodeRef.data value updates across multiple change() calls.
 *
 * TreeNodeRef uses StructRef internally for the `.data` property. Since StructRef
 * has the stale cache bug, TreeNodeRef inherits it. When you update a node's
 * data properties in one change() and read them outside, you get stale values.
 *
 * This test file demonstrates the inherited bug from StructRef.
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

      // Read the node data outside of change()
      const node = doc.states.getNodeByID(nodeId)
      expect(node?.data.name).toBe("initial")
      expect(node?.data.value).toBe(100)

      // Update the node data in a new change()
      const capturedNodeId = nodeId
      change(doc, draft => {
        const draftNode = draft.states.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.name = "updated"
          draftNode.data.value = 999
        }
      })

      // Read again - should see updated values
      // BUG: Returns stale cached values from StructRef
      expect(node?.data.name).toBe("updated") // FAILS: returns "initial"
      expect(node?.data.value).toBe(999) // FAILS: returns 100
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

      // Multiple updates
      for (let i = 1; i <= 5; i++) {
        change(doc, draft => {
          const draftNode = draft.tree.getNodeByID(capturedNodeId)
          if (draftNode) {
            draftNode.data.count = i
          }
        })
        expect(node?.data.count).toBe(i) // FAILS on i > 1
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
      expect(node?.data.active).toBe(true)

      change(doc, draft => {
        const draftNode = draft.nodes.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.active = false
        }
      })

      expect(node?.data.active).toBe(false) // FAILS: returns true
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
      expect(node?.data.name).toBe("state1")
      expect(node?.data.facts.get("key1")).toBe("value1")

      // Update both the plain value and the record
      change(doc, draft => {
        const draftNode = draft.states.getNodeByID(capturedNodeId)
        if (draftNode) {
          draftNode.data.name = "state2"
          draftNode.data.facts.set("key1", "updated")
          draftNode.data.facts.set("key2", "new")
        }
      })

      // The name update will fail due to StructRef cache
      // The facts updates should work since RecordRef is fixed
      expect(node?.data.name).toBe("state2") // FAILS: returns "state1"
      expect(node?.data.facts.get("key1")).toBe("updated") // Should pass (RecordRef fixed)
      expect(node?.data.facts.get("key2")).toBe("new") // Should pass (RecordRef fixed)
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
      if (!parentId) throw new Error("parentId should be defined")
      if (!childId) throw new Error("childId should be defined")

      const capturedParentId = parentId
      const capturedChildId = childId
      const parent = doc.tree.getNodeByID(capturedParentId)
      const child = doc.tree.getNodeByID(capturedChildId)
      expect(parent?.data.label).toBe("parent")
      expect(child?.data.label).toBe("child")

      // Update both nodes
      change(doc, draft => {
        const draftParent = draft.tree.getNodeByID(capturedParentId)
        const draftChild = draft.tree.getNodeByID(capturedChildId)
        if (draftParent) draftParent.data.label = "parent-updated"
        if (draftChild) draftChild.data.label = "child-updated"
      })

      expect(parent?.data.label).toBe("parent-updated") // FAILS
      expect(child?.data.label).toBe("child-updated") // FAILS
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
          node.data.status = "complete"
        }
      })

      // toJSON reads from container, so it should work
      const json2 = doc.toJSON()
      expect(json2.tree[0]?.data.status).toBe("complete")
    })
  })
})
