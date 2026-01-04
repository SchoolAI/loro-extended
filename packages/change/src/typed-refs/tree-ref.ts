import type { LoroTree, LoroTreeNode, TreeID } from "loro-crdt"
import type {
  StructContainerShape,
  TreeContainerShape,
  TreeNodeJSON,
} from "../shape.js"
import type { Infer } from "../types.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import type { TreeNodeRef } from "./tree-node-ref.js"
import { TreeRefInternals } from "./tree-ref-internals.js"

/**
 * Typed ref for tree (forest) containers - thin facade that delegates to TreeRefInternals.
 * Wraps LoroTree with type-safe access to node metadata.
 *
 * @example
 * ```typescript
 * const StateNodeDataShape = Shape.struct({
 *   name: Shape.text(),
 *   facts: Shape.record(Shape.plain.any()),
 * })
 *
 * doc.$.change(draft => {
 *   const root = draft.states.createNode({ name: "idle", facts: {} })
 *   const child = root.createNode({ name: "running", facts: {} })
 *   child.data.name = "active"
 * })
 * ```
 */
export class TreeRef<DataShape extends StructContainerShape> extends TypedRef<
  TreeContainerShape<DataShape>
> {
  [INTERNAL_SYMBOL]: TreeRefInternals<DataShape>

  constructor(params: TypedRefParams<TreeContainerShape<DataShape>>) {
    super()
    this[INTERNAL_SYMBOL] = new TreeRefInternals(params)
    this[INTERNAL_SYMBOL].setTreeRef(this)
  }

  /**
   * Get the data shape for tree nodes.
   */
  private get dataShape(): DataShape {
    return this[INTERNAL_SYMBOL].getDataShape()
  }

  /**
   * Get or create a node ref for a LoroTreeNode.
   */
  getOrCreateNodeRef(node: LoroTreeNode): TreeNodeRef<DataShape> {
    return this[INTERNAL_SYMBOL].getOrCreateNodeRef(node)
  }

  /**
   * Get a node by its ID.
   */
  getNodeByID(id: TreeID): TreeNodeRef<DataShape> | undefined {
    return this[INTERNAL_SYMBOL].getNodeByID(id)
  }

  /**
   * Delete a node from the tree.
   */
  delete(target: TreeID | TreeNodeRef<DataShape>): void {
    this[INTERNAL_SYMBOL].delete(target)
  }

  /**
   * Serialize the tree to a nested JSON structure.
   * Each node includes its data and children recursively.
   */
  toJSON(): Infer<TreeContainerShape<DataShape>> {
    // Use Loro's native toJSON which returns nested structure
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    const nativeJson = container.toJSON() as any[]
    return this.transformNativeJson(nativeJson) as Infer<
      TreeContainerShape<DataShape>
    >
  }

  /**
   * Create a new root node with optional initial data.
   *
   * @param initialData - Optional partial data to initialize the node with
   * @returns The created TreeNodeRef
   */
  createNode(initialData?: Partial<Infer<DataShape>>): TreeNodeRef<DataShape> {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    const loroNode = container.createNode()
    const nodeRef = this.getOrCreateNodeRef(loroNode)

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
   * Get all root nodes (nodes without parents).
   * Returns nodes in their fractional index order.
   */
  roots(): TreeNodeRef<DataShape>[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    return container.roots().map(node => this.getOrCreateNodeRef(node))
  }

  /**
   * Get all nodes in the tree (unordered).
   * Includes all nodes, not just roots.
   */
  nodes(): TreeNodeRef<DataShape>[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    return container.nodes().map(node => this.getOrCreateNodeRef(node))
  }

  /**
   * Check if a node with the given ID exists in the tree.
   */
  has(id: TreeID): boolean {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    return container.has(id)
  }

  /**
   * Enable fractional index generation for ordering.
   *
   * @param jitter - Optional jitter value to avoid conflicts (0 = no jitter)
   */
  enableFractionalIndex(jitter = 0): void {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    container.enableFractionalIndex(jitter)
  }

  /**
   * Transform Loro's native JSON format to our typed format.
   */
  private transformNativeJson(nodes: any[]): TreeNodeJSON<DataShape>[] {
    return nodes.map(node => ({
      id: node.id as TreeID,
      parent: node.parent as TreeID | null,
      index: node.index as number,
      fractionalIndex: node.fractional_index as string,
      data: node.meta as Infer<DataShape>,
      children: this.transformNativeJson(node.children || []),
    }))
  }

  /**
   * Get a flat array representation of all nodes.
   * Flattens the nested tree structure into a single array.
   */
  toArray(): Array<{
    id: TreeID
    parent: TreeID | null
    index: number
    fractionalIndex: string
    data: Infer<DataShape>
  }> {
    const result: Array<{
      id: TreeID
      parent: TreeID | null
      index: number
      fractionalIndex: string
      data: Infer<DataShape>
    }> = []

    // Flatten the nested structure
    const flattenNodes = (nodes: any[]) => {
      for (const node of nodes) {
        result.push({
          id: node.id as TreeID,
          parent: node.parent as TreeID | null,
          index: node.index as number,
          fractionalIndex: node.fractional_index as string,
          data: node.meta as Infer<DataShape>,
        })
        if (node.children && node.children.length > 0) {
          flattenNodes(node.children)
        }
      }
    }

    const container = this[INTERNAL_SYMBOL].getContainer() as LoroTree
    const nativeJson = container.toJSON() as any[]
    flattenNodes(nativeJson)
    return result
  }
}
