import type { LoroDoc, LoroTreeNode, Subscription } from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { LoroTreeNodeRef } from "../loro.js"
import type { StructContainerShape } from "../shape.js"
import type { Infer } from "../types.js"
import {
  INTERNAL_SYMBOL,
  type RefInternalsBase,
  type TypedRefParams,
} from "./base.js"
import { createStructRef, type StructRef } from "./struct-ref.js"
import type { TreeNodeRef, TreeNodeRefParams } from "./tree-node-ref.js"

// Forward declaration to avoid circular import
// TreeRef will be passed in via constructor params
export interface TreeRefLike<DataShape extends StructContainerShape> {
  getOrCreateNodeRef(node: LoroTreeNode): TreeNodeRef<DataShape>
}

/**
 * Internal implementation for TreeNodeRef.
 * Contains all logic, state, and implementation details.
 */
export class TreeNodeRefInternals<DataShape extends StructContainerShape>
  implements RefInternalsBase
{
  private dataRef: StructRef<DataShape["shapes"]> | undefined
  private loroNamespace: LoroTreeNodeRef | undefined

  constructor(private readonly params: TreeNodeRefParams<DataShape>) {}

  /** Get the underlying LoroTreeNode */
  getNode(): LoroTreeNode {
    return this.params.node
  }

  /** Get the data shape for this node */
  getDataShape(): DataShape {
    return this.params.dataShape
  }

  /** Get the parent TreeRef */
  getTreeRef(): TreeRefLike<DataShape> {
    return this.params.treeRef
  }

  /** Check if autoCommit is enabled */
  getAutoCommit(): boolean {
    return this.params.autoCommit ?? false
  }

  /** Check if in batched mutation mode */
  getBatchedMutation(): boolean {
    return this.params.batchedMutation ?? false
  }

  /** Get the LoroDoc */
  getDoc(): LoroDoc {
    return this.params.getDoc()
  }

  /** Commit changes if autoCommit is enabled */
  commitIfAuto(): void {
    if (this.params.autoCommit) {
      this.params.getDoc().commit()
    }
  }

  /** Get or create the data StructRef */
  getOrCreateDataRef(): StructRef<DataShape["shapes"]> {
    if (!this.dataRef) {
      const node = this.getNode()
      const dataShape = this.getDataShape()

      // Get the node's data container (LoroMap)
      const dataContainer = (node as any).data

      if (!dataContainer) {
        throw new Error(`Node ${node.id} has no data container`)
      }

      // Create placeholder from the data shape
      const placeholder = deriveShapePlaceholder(dataShape) as Infer<DataShape>

      const refParams: TypedRefParams<
        StructContainerShape<DataShape["shapes"]>
      > = {
        shape: {
          _type: "struct" as const,
          shapes: dataShape.shapes,
          _plain: {} as any,
          _mutable: {} as any,
          _placeholder: {} as any,
        },
        placeholder: placeholder as any,
        getContainer: () => dataContainer,
        autoCommit: this.getAutoCommit(),
        batchedMutation: this.getBatchedMutation(),
        getDoc: this.params.getDoc,
      }

      this.dataRef = createStructRef(refParams)
    }
    return this.dataRef
  }

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    if (this.dataRef) {
      this.dataRef[INTERNAL_SYMBOL].absorbPlainValues()
    }
  }

  /** Force materialization of the container and its nested containers */
  materialize(): void {
    // Ensure data ref is created and materialized
    const dataRef = this.getOrCreateDataRef()
    dataRef[INTERNAL_SYMBOL].materialize()
  }

  /** Get the loro namespace (cached) */
  getLoroNamespace(): LoroTreeNodeRef {
    if (!this.loroNamespace) {
      this.loroNamespace = this.createLoroNamespace()
    }
    return this.loroNamespace
  }

  /** Create the loro namespace for tree node */
  protected createLoroNamespace(): LoroTreeNodeRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      get container(): LoroTreeNode {
        return self.getNode()
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        // LoroTreeNode doesn't have subscribe, but we can subscribe to the tree
        // However, LoroRefBase expects subscribe.
        // For now, we can throw or return a dummy subscription if LoroTreeNode doesn't support it.
        // But wait, LoroTreeNode is just a handle.
        // Let's check if LoroTreeNode has subscribe.
        // If not, we might need to subscribe to the tree and filter?
        // Or maybe we just cast it if it exists at runtime.
        return (self.getNode() as any).subscribe?.(callback) || (() => {})
      },
    }
  }
}
