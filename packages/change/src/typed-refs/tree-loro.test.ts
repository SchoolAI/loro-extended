import { describe, expect, it } from "vitest"
import { type ExtRefBase, ext } from "../ext.js"
import { change } from "../functional-helpers.js"
import { loro } from "../loro.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("TreeRef loro() and ext() support", () => {
  it("should support loro() and ext() on TreeRef property", () => {
    const StateNodeDataShape = Shape.struct({
      name: Shape.plain.string(),
    })

    const Schema = Shape.doc({
      states: Shape.tree(StateNodeDataShape),
    })

    const doc = createTypedDoc(Schema)

    // loro(ref) returns the native container directly
    const treeContainer = loro(doc.states)
    expect(treeContainer).toBeDefined()
    expect(typeof treeContainer.subscribe).toBe("function")

    // ext(ref) provides loro-extended features including doc access
    const treeExt = ext(doc.states)
    expect(treeExt).toBeDefined()
    expect(treeExt.doc).toBeDefined()
  })

  it("should support loro() and ext() on TreeNodeRef", () => {
    const StateNodeDataShape = Shape.struct({
      name: Shape.plain.string(),
    })

    const Schema = Shape.doc({
      states: Shape.tree(StateNodeDataShape),
    })

    const doc = createTypedDoc(Schema)

    change(doc, draft => {
      const root = draft.states.createNode({ name: "root" })

      // loro(ref) returns the native container directly (LoroTreeNode)
      const nodeContainer = loro(root)
      expect(nodeContainer).toBeDefined()

      // ext(ref) provides loro-extended features including doc access
      const nodeExt = ext(root) as ExtRefBase
      expect(nodeExt).toBeDefined()
      expect(nodeExt.doc).toBeDefined()
    })
  })
})
