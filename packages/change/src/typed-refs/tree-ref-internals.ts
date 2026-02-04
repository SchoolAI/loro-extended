import type {
  LoroDoc,
  LoroEventBatch,
  LoroTree,
  LoroTreeNode,
  Subscription,
  TreeID,
} from "loro-crdt"
import type { ExtRefBase } from "../ext.js"
import type { StructContainerShape, TreeContainerShape } from "../shape.js"
import { BaseRefInternals, INTERNAL_SYMBOL } from "./base.js"
import { TreeNodeRef } from "./tree-node-ref.js"
import type { TreeRef } from "./tree-ref.js"

/**
 * Internal implementation for TreeRef.
 * Contains all logic, state, and implementation details.
 */
export class TreeRefInternals<
  DataShape extends StructContainerShape,
> extends BaseRefInternals<TreeContainerShape<DataShape>> {
  private nodeCache = new Map<TreeID, TreeNodeRef<DataShape>>()
  private treeRef: TreeRef<DataShape> | null = null

  /** Set the parent TreeRef (needed for creating node refs) */
  setTreeRef(treeRef: TreeRef<DataShape>): void {
    this.treeRef = treeRef
  }

  /** Get the data shape for tree nodes */
  getDataShape(): DataShape {
    const shape = this.getShape() as TreeContainerShape<DataShape>
    return shape.shape
  }

  /** Get or create a node ref for a LoroTreeNode */
  getOrCreateNodeRef(node: LoroTreeNode): TreeNodeRef<DataShape> {
    const id = node.id

    if (!this.treeRef) {
      throw new Error("treeRef required")
    }

    let nodeRef = this.nodeCache.get(id)
    if (!nodeRef) {
      nodeRef = new TreeNodeRef({
        node,
        dataShape: this.getDataShape(),
        treeRef: this.treeRef,
        autoCommit: this.getAutoCommit(),
        batchedMutation: this.getBatchedMutation(),
        getDoc: () => this.getDoc(),
      })
      this.nodeCache.set(id, nodeRef)
    }

    return nodeRef
  }

  /** Get a node by its ID */
  getNodeByID(id: TreeID): TreeNodeRef<DataShape> | undefined {
    // Check cache first
    const cached = this.nodeCache.get(id)
    if (cached) return cached

    const container = this.getContainer() as LoroTree

    // Check if node exists in tree
    if (!container.has(id)) return undefined

    // Find the node in the tree's nodes
    const nodes = container.nodes()
    const node = nodes.find(n => n.id === id)
    if (!node) return undefined

    return this.getOrCreateNodeRef(node)
  }

  /** Delete a node from the tree */
  delete(target: TreeID | TreeNodeRef<DataShape>): void {
    const id = typeof target === "string" ? target : target.id
    const container = this.getContainer() as LoroTree
    container.delete(id)
    // Remove from cache
    this.nodeCache.delete(id)
    this.commitIfAuto()
  }

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    for (const nodeRef of this.nodeCache.values()) {
      nodeRef[INTERNAL_SYMBOL].absorbPlainValues()
    }
  }

  /** Create the ext namespace for tree */
  protected override createExtNamespace(): ExtRefBase {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      change<T>(_fn: (draft: T) => void): T {
        throw new Error(
          "Use the change() functional helper for ref-level changes: change(ref, fn)",
        )
      },
      subscribe(callback: (event: LoroEventBatch) => void): Subscription {
        return (self.getContainer() as LoroTree).subscribe(callback)
      },
    }
  }
}
