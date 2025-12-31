import type { LoroDoc, LoroTreeNode, TreeID } from "loro-crdt"
import { deriveShapePlaceholder } from "../derive-placeholder.js"
import type { StructContainerShape } from "../shape.js"
import type { Infer } from "../types.js"
import type { TypedRefParams } from "./base.js"
import { StructRef } from "./struct.js"

// Forward declaration to avoid circular import
// TreeRef will be passed in via constructor params
interface TreeRefLike<DataShape extends StructContainerShape> {
  getOrCreateNodeRef(node: LoroTreeNode): TreeNodeRef<DataShape>
}

export interface TreeNodeRefParams<DataShape extends StructContainerShape> {
  node: LoroTreeNode
  dataShape: DataShape
  treeRef: TreeRefLike<DataShape>
  readonly?: boolean
  autoCommit?: boolean
  getDoc?: () => LoroDoc
}

/**
 * Typed ref for a single tree node.
 * Provides type-safe access to node metadata via the `.data` property.
 *
 * @example
 * ```typescript
 * const node = tree.createNode({ name: "idle", facts: {} })
 * node.data.name = "active"  // Typed access
 * const child = node.createNode({ name: "running", facts: {} })
 * ```
 */
export class TreeNodeRef<DataShape extends StructContainerShape> {
  private _node: LoroTreeNode
  private _dataShape: DataShape
  private _treeRef: TreeRefLike<DataShape>
  private _dataRef?: StructRef<DataShape["shapes"]>
  private _readonly: boolean
  private _autoCommit: boolean
  private _getDoc?: () => LoroDoc

  constructor(params: TreeNodeRefParams<DataShape>) {
    this._node = params.node
    this._dataShape = params.dataShape
    this._treeRef = params.treeRef
    this._readonly = params.readonly ?? false
    this._autoCommit = params.autoCommit ?? false
    this._getDoc = params.getDoc
  }

  /**
   * The unique TreeID of this node.
   */
  get id(): TreeID {
    return this._node.id
  }

  /**
   * Typed access to the node's metadata.
   * This is a StructRef wrapping the node's LoroMap data container.
   */
  get data(): StructRef<DataShape["shapes"]> & {
    [K in keyof DataShape["shapes"]]: DataShape["shapes"][K]["_mutable"]
  } {
    if (!this._dataRef) {
      // Get the node's data container (LoroMap)
      // In Loro, node.data is accessed via the tree's getNodeByID
      // The data is stored as a LoroMap associated with the node
      const dataContainer = (this._node as any).data

      if (!dataContainer) {
        throw new Error(`Node ${this.id} has no data container`)
      }

      // Create placeholder from the data shape
      const placeholder = deriveShapePlaceholder(
        this._dataShape,
      ) as Infer<DataShape>

      const params: TypedRefParams<StructContainerShape<DataShape["shapes"]>> =
        {
          shape: {
            _type: "struct" as const,
            shapes: this._dataShape.shapes,
            _plain: {} as any,
            _mutable: {} as any,
            _placeholder: {} as any,
          },
          placeholder: placeholder as any,
          getContainer: () => dataContainer,
          readonly: this._readonly,
          autoCommit: this._autoCommit,
          getDoc: this._getDoc,
        }

      this._dataRef = new StructRef(params)
    }

    return this._dataRef as StructRef<DataShape["shapes"]> & {
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
    this.assertMutable()
    // Create child node - Loro's createNode on a tree node creates a child
    const loroNode = (this._node as any).createNode(index)
    const nodeRef = this._treeRef.getOrCreateNodeRef(loroNode)

    // Initialize data if provided
    if (initialData) {
      for (const [key, value] of Object.entries(initialData)) {
        ;(nodeRef.data as any)[key] = value
      }
    }

    this.commitIfAuto()
    return nodeRef
  }

  /**
   * Get the parent node, if any.
   */
  parent(): TreeNodeRef<DataShape> | undefined {
    const parentNode = (this._node as any).parent?.()
    if (!parentNode) return undefined
    return this._treeRef.getOrCreateNodeRef(parentNode)
  }

  /**
   * Get all child nodes in order.
   */
  children(): TreeNodeRef<DataShape>[] {
    const childNodes = (this._node as any).children?.() || []
    return childNodes.map((node: LoroTreeNode) =>
      this._treeRef.getOrCreateNodeRef(node),
    )
  }

  /**
   * Move this node to a new parent.
   *
   * @param newParent - The new parent node (undefined for root)
   * @param index - Optional position among siblings
   */
  move(newParent?: TreeNodeRef<DataShape>, index?: number): void {
    this.assertMutable()
    // node.move takes a LoroTreeNode or undefined, not an ID
    const parentNode = newParent?._node
    ;(this._node as any).move?.(parentNode, index)
    this.commitIfAuto()
  }

  /**
   * Move this node to be after the given sibling.
   */
  moveAfter(sibling: TreeNodeRef<DataShape>): void {
    this.assertMutable()
    this._node.moveAfter(sibling._node)
    this.commitIfAuto()
  }

  /**
   * Move this node to be before the given sibling.
   */
  moveBefore(sibling: TreeNodeRef<DataShape>): void {
    this.assertMutable()
    this._node.moveBefore(sibling._node)
    this.commitIfAuto()
  }

  /**
   * Get the index of this node among its siblings.
   */
  index(): number | undefined {
    return this._node.index()
  }

  /**
   * Get the fractional index string for ordering.
   */
  fractionalIndex(): string | undefined {
    return this._node.fractionalIndex()
  }

  /**
   * Check if this node has been deleted.
   */
  isDeleted(): boolean {
    return this._node.isDeleted()
  }

  /**
   * Absorb plain values from the data StructRef.
   */
  absorbPlainValues(): void {
    if (this._dataRef) {
      this._dataRef.absorbPlainValues()
    }
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

  private assertMutable(): void {
    if (this._readonly) {
      throw new Error("Cannot modify readonly ref")
    }
  }

  private commitIfAuto(): void {
    if (this._autoCommit && this._getDoc) {
      this._getDoc().commit()
    }
  }
}
