import type { LoroDoc, LoroTreeNode, TreeID } from "loro-crdt"
import type { StructContainerShape } from "../shape.js"
import type { Infer } from "../types.js"
import { INTERNAL_SYMBOL } from "./base.js"
import type { StructRef } from "./struct-ref.js"
import {
  TreeNodeRefInternals,
  type TreeRefLike,
} from "./tree-node-ref-internals.js"

export interface TreeNodeRefParams<DataShape extends StructContainerShape> {
  node: LoroTreeNode
  dataShape: DataShape
  treeRef: TreeRefLike<DataShape>
  autoCommit?: boolean
  batchedMutation?: boolean
  getDoc: () => LoroDoc
}

/**
 * Typed ref for a single tree node - thin facade that delegates to TreeNodeRefInternals.
 * Provides type-safe access to node metadata via the `.data` property.
 *
 * **Note:** TreeNodeRef is not a subclass of TypedRef, but it implements
 * `[INTERNAL_SYMBOL]: RefInternalsBase` for consistency with other refs.
 * This allows internal code to call `absorbPlainValues()` uniformly
 * across all ref types during the `change()` commit phase.
 *
 * @example
 * ```typescript
 * const node = tree.createNode({ name: "idle", facts: {} })
 * node.data.name = "active"  // Typed access
 * const child = node.createNode({ name: "running", facts: {} })
 * ```
 */
export class TreeNodeRef<DataShape extends StructContainerShape> {
  [INTERNAL_SYMBOL]: TreeNodeRefInternals<DataShape>

  constructor(params: TreeNodeRefParams<DataShape>) {
    this[INTERNAL_SYMBOL] = new TreeNodeRefInternals(params)
  }

  /**
   * The unique TreeID of this node.
   */
  get id(): TreeID {
    return this[INTERNAL_SYMBOL].getNode().id
  }

  /**
   * Typed access to the node's metadata.
   * This is a StructRef wrapping the node's LoroMap data container.
   */
  get data(): StructRef<DataShape["shapes"]> & {
    [K in keyof DataShape["shapes"]]: DataShape["shapes"][K]["_mutable"]
  } {
    return this[INTERNAL_SYMBOL].getOrCreateDataRef() as StructRef<
      DataShape["shapes"]
    > & {
      [K in keyof DataShape["shapes"]]: DataShape["shapes"][K]["_mutable"]
    }
  }

  /**
   * Create a child node under this node.
   *
   * @param initialData - Optional partial data to initialize the child with
   * @param index - Optional position among siblings
   * @returns The created child TreeNodeRef
   */
  createNode(
    initialData?: Partial<Infer<DataShape>>,
    index?: number,
  ): TreeNodeRef<DataShape> {
    const node = this[INTERNAL_SYMBOL].getNode()
    const treeRef = this[INTERNAL_SYMBOL].getTreeRef()

    // Create child node - Loro's createNode on a tree node creates a child
    const loroNode = (node as any).createNode(index)
    const nodeRef = treeRef.getOrCreateNodeRef(loroNode)

    // Initialize data if provided
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) {
        ;(nodeRef.data as any)[key] = value
      }
    }

    this[INTERNAL_SYMBOL].commitIfAuto()
    return nodeRef
  }

  /**
   * Get the parent node, if any.
   */
  parent(): TreeNodeRef<DataShape> | undefined {
    const node = this[INTERNAL_SYMBOL].getNode()
    const treeRef = this[INTERNAL_SYMBOL].getTreeRef()

    const parentNode = (node as any).parent?.()
    if (!parentNode) return undefined
    return treeRef.getOrCreateNodeRef(parentNode)
  }

  /**
   * Get all child nodes in order.
   */
  children(): TreeNodeRef<DataShape>[] {
    const node = this[INTERNAL_SYMBOL].getNode()
    const treeRef = this[INTERNAL_SYMBOL].getTreeRef()

    const childNodes = (node as any).children?.() || []
    return childNodes.map((n: LoroTreeNode) => treeRef.getOrCreateNodeRef(n))
  }

  /**
   * Move this node to a new parent.
   *
   * @param newParent - The new parent node (undefined for root)
   * @param index - Optional position among siblings
   */
  move(newParent?: TreeNodeRef<DataShape>, index?: number): void {
    const node = this[INTERNAL_SYMBOL].getNode()

    // node.move takes a LoroTreeNode or undefined, not an ID
    const parentNode = newParent
      ? newParent[INTERNAL_SYMBOL].getNode()
      : undefined
    ;(node as any).move?.(parentNode, index)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  /**
   * Move this node to be after the given sibling.
   */
  moveAfter(sibling: TreeNodeRef<DataShape>): void {
    const node = this[INTERNAL_SYMBOL].getNode()
    const siblingNode = sibling[INTERNAL_SYMBOL].getNode()

    node.moveAfter(siblingNode)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  /**
   * Move this node to be before the given sibling.
   */
  moveBefore(sibling: TreeNodeRef<DataShape>): void {
    const node = this[INTERNAL_SYMBOL].getNode()
    const siblingNode = sibling[INTERNAL_SYMBOL].getNode()

    node.moveBefore(siblingNode)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  /**
   * Get the index of this node among its siblings.
   */
  index(): number | undefined {
    const node = this[INTERNAL_SYMBOL].getNode()
    return node.index()
  }

  /**
   * Get the fractional index string for ordering.
   */
  fractionalIndex(): string | undefined {
    const node = this[INTERNAL_SYMBOL].getNode()
    return node.fractionalIndex()
  }

  /**
   * Check if this node has been deleted.
   */
  isDeleted(): boolean {
    const node = this[INTERNAL_SYMBOL].getNode()
    return node.isDeleted()
  }

  /**
   * Serialize this node and its descendants to JSON.
   */
  toJSON(): {
    id: TreeID
    parent: TreeID | null
    index: number
    fractionalIndex: string
    data: Infer<DataShape>
    children: any[]
  } {
    const children = this.children()
    return {
      id: this.id,
      parent: this.parent()?.id ?? null,
      index: this.index() ?? 0,
      fractionalIndex: this.fractionalIndex() ?? "",
      data: this.data.toJSON() as Infer<DataShape>,
      children: children.map(child => child.toJSON()),
    }
  }
}
