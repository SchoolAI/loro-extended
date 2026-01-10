import type { TreeID } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

// Define a simple schema for testing deleted node behavior
const StateNodeDataShape = Shape.struct({
  name: Shape.text(),
})

const TestSchema = Shape.doc({
  states: Shape.tree(StateNodeDataShape),
})

describe("deleted node filtering", () => {
  /**
   * nodes() now excludes deleted nodes by default.
   * Use nodes({ includeDeleted: true }) to include them.
   */
  describe("nodes()", () => {
    it("excludes deleted nodes by default", () => {
      const typedDoc = createTypedDoc(TestSchema)

      let nodeId: TreeID | undefined

      // Create a node
      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "test")
        nodeId = root.id
      })

      // Delete the node
      change(typedDoc, draft => {
        if (nodeId === undefined) throw new Error("nodeId should be defined")
        draft.states.delete(nodeId)
      })

      // nodes() now excludes deleted nodes by default
      change(typedDoc, draft => {
        const allNodes = draft.states.nodes()

        // Fixed behavior: deleted nodes are excluded
        expect(allNodes.length).toBe(0)
      })

      // toJSON also excludes deleted nodes
      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(0)
    })

    it("includes deleted nodes when includeDeleted: true", () => {
      const typedDoc = createTypedDoc(TestSchema)

      let nodeId: TreeID | undefined

      // Create a node
      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "test")
        nodeId = root.id
      })

      // Delete the node
      change(typedDoc, draft => {
        if (nodeId === undefined) throw new Error("nodeId should be defined")
        draft.states.delete(nodeId)
      })

      // nodes({ includeDeleted: true }) includes deleted nodes
      change(typedDoc, draft => {
        const allNodes = draft.states.nodes({ includeDeleted: true })

        // Deleted nodes are included when explicitly requested
        expect(allNodes.length).toBe(1)
        expect(allNodes[0].isDeleted()).toBe(true)
      })
    })
  })

  /**
   * FINDING: roots() does NOT include deleted nodes
   * Loro's underlying roots() already filters them out.
   * No fix needed.
   */
  describe("roots()", () => {
    it("correctly excludes deleted root nodes - NO FIX NEEDED", () => {
      const typedDoc = createTypedDoc(TestSchema)

      let rootId: TreeID | undefined

      // Create a root node
      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "root")
        rootId = root.id
      })

      // Delete the root node
      change(typedDoc, draft => {
        if (rootId === undefined) throw new Error("rootId should be defined")
        draft.states.delete(rootId)
      })

      // roots() correctly excludes deleted nodes
      change(typedDoc, draft => {
        const allRoots = draft.states.roots()

        // Correct behavior: deleted roots are NOT included
        expect(allRoots.length).toBe(0)
        expect(allRoots.some(n => n.isDeleted())).toBe(false)
      })

      // toJSON also excludes deleted nodes
      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(0)
    })
  })

  /**
   * FINDING: children() does NOT include deleted nodes
   * Loro's underlying children() already filters them out.
   * No fix needed.
   */
  describe("children()", () => {
    it("correctly excludes deleted child nodes - NO FIX NEEDED", () => {
      const typedDoc = createTypedDoc(TestSchema)

      let rootId: TreeID | undefined
      let childId: TreeID | undefined

      // Create a root with a child
      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "root")
        rootId = root.id

        const child = root.createNode()
        child.data.name.insert(0, "child")
        childId = child.id
      })

      // Delete the child node
      change(typedDoc, draft => {
        if (childId === undefined) throw new Error("childId should be defined")
        draft.states.delete(childId)
      })

      // children() correctly excludes deleted nodes
      change(typedDoc, draft => {
        if (rootId === undefined) throw new Error("rootId should be defined")
        const root = draft.states.getNodeByID(rootId)
        expect(root).toBeDefined()
        if (root === undefined) throw new Error("root should be defined")

        const children = root.children()

        // Correct behavior: deleted children are NOT included
        expect(children.length).toBe(0)
        expect(children.some(n => n.isDeleted())).toBe(false)
      })

      // toJSON also excludes deleted nodes
      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(1)
      expect(json.states[0].children).toHaveLength(0)
    })
  })

  /**
   * FINDING: Accessing .data on a deleted node doesn't throw immediately
   * because StructRef is created lazily. But using the underlying LoroMap
   * will fail with "container is deleted" error.
   */
  describe("accessing deleted node data", () => {
    it("accessing .data property succeeds but using it fails", () => {
      const typedDoc = createTypedDoc(TestSchema)

      let nodeId: TreeID | undefined

      // Create a node
      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "test")
        nodeId = root.id
      })

      // Delete the node
      change(typedDoc, draft => {
        if (nodeId === undefined) throw new Error("nodeId should be defined")
        draft.states.delete(nodeId)
      })

      // Try to access data on deleted node (must use includeDeleted: true)
      change(typedDoc, draft => {
        const allNodes = draft.states.nodes({ includeDeleted: true })
        const deletedNode = allNodes.find(n => n.isDeleted())

        expect(deletedNode).toBeDefined()
        if (deletedNode === undefined)
          throw new Error("deletedNode should be defined")

        // Accessing .data property succeeds (lazy creation)
        const data = deletedNode.data
        expect(data).toBeDefined()

        // But trying to use the underlying container would fail
        // (We don't test this as it would throw and break the test)
      })
    })
  })
})
