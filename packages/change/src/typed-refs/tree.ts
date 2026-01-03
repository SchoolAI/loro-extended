import type {
  LoroDoc,
  LoroTree,
  LoroTreeNode,
  Subscription,
  TreeID,
} from "loro-crdt"
import type {
  StructContainerShape,
  TreeContainerShape,
  TreeNodeJSON,
} from "../shape.js"
import type { Infer } from "../types.js"
import { TreeNodeRef } from "./tree-node.js"

/**
 * Parameters for creating a TreeRef.
 */
export interface TreeRefParams<DataShape extends StructContainerShape> {
  shape: TreeContainerShape<DataShape>
  placeholder?: never[]
  getContainer: () => LoroTree
  autoCommit?: boolean
  batchedMutation?: boolean
  getDoc?: () => LoroDoc
}

/**
 * Meta-operations namespace for TreeRef.
 * Provides access to underlying Loro primitives.
 */
export interface TreeRefMetaNamespace {
  /**
   * Access the underlying LoroDoc.
   * Returns undefined if the ref was created outside of a doc context.
   */
  readonly loroDoc: LoroDoc | undefined

  /**
   * Access the underlying LoroTree container.
   */
  readonly loroContainer: LoroTree

  /**
   * Subscribe to tree-level changes.
   * @param callback - Function called when the tree changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (event: unknown) => void): Subscription
}

/**
 * Typed ref for tree (forest) containers.
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
export class TreeRef<DataShape extends StructContainerShape> {
  private nodeCache = new Map<TreeID, TreeNodeRef<DataShape>>()
  private _cachedContainer?: LoroTree
  protected _params: TreeRefParams<DataShape>
  private _$?: TreeRefMetaNamespace

  constructor(params: TreeRefParams<DataShape>) {
    this._params = params
  }

  /**
   * Meta-operations namespace for accessing underlying Loro primitives.
   *
   * @example
   * ```typescript
   * // Access the underlying LoroDoc
   * treeRef.$.loroDoc?.subscribe((event) => console.log("Doc changed"))
   *
   * // Access the underlying LoroTree container
   * treeRef.$.loroContainer  // LoroTree
   *
   * // Subscribe to tree-level changes
   * treeRef.$.subscribe((event) => console.log("Tree changed"))
   * ```
   */
  get $(): TreeRefMetaNamespace {
    if (!this._$) {
      const self = this
      this._$ = {
        get loroDoc(): LoroDoc | undefined {
          return self._params.getDoc?.()
        },
        get loroContainer(): LoroTree {
          return self.container
        },
        subscribe(callback: (event: unknown) => void): Subscription {
          return self.container.subscribe(callback)
        },
      }
    }
    return this._$
  }

  protected get shape(): TreeContainerShape<DataShape> {
    return this._params.shape
  }

  protected get container(): LoroTree {
    if (!this._cachedContainer) {
      this._cachedContainer = this._params.getContainer()
    }
    return this._cachedContainer
  }

  protected get dataShape(): DataShape {
    return this.shape.shape
  }

  protected get autoCommit(): boolean {
    return !!this._params.autoCommit
  }

  protected get batchedMutation(): boolean {
    return !!this._params.batchedMutation
  }

  protected get doc(): LoroDoc | undefined {
    return this._params.getDoc?.()
  }

  /**
   * Commits changes if autoCommit is enabled.
   */
  protected commitIfAuto(): void {
    if (this.autoCommit && this.doc) {
      this.doc.commit()
    }
  }

  /**
   * Absorb plain values from all cached nodes.
   * Called before committing changes to ensure all pending values are written.
   */
  absorbPlainValues(): void {
    for (const nodeRef of this.nodeCache.values()) {
      nodeRef.absorbPlainValues()
    }
  }

  /**
   * Get or create a TreeNodeRef for the given LoroTreeNode.
   * Uses caching to ensure the same TreeNodeRef is returned for the same node.
   */
  getOrCreateNodeRef(node: LoroTreeNode): TreeNodeRef<DataShape> {
    const id = node.id
    let nodeRef = this.nodeCache.get(id)
    if (!nodeRef) {
      nodeRef = new TreeNodeRef({
        node,
        dataShape: this.dataShape,
        treeRef: this,
        autoCommit: this.autoCommit,
        batchedMutation: this.batchedMutation,
        getDoc: this._params.getDoc,
      })
      this.nodeCache.set(id, nodeRef)
    }
    return nodeRef
  }

  /**
   * Create a new root node with optional initial data.
   *
   * @param initialData - Optional partial data to initialize the node with
   * @returns The created TreeNodeRef
   */
  createNode(initialData?: Partial<Infer<DataShape>>): TreeNodeRef<DataShape> {
    const loroNode = this.container.createNode()
    const nodeRef = this.getOrCreateNodeRef(loroNode)

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
   * Get all root nodes (nodes without parents).
   * Returns nodes in their fractional index order.
   */
  roots(): TreeNodeRef<DataShape>[] {
    return this.container.roots().map(node => this.getOrCreateNodeRef(node))
  }

  /**
   * Get all nodes in the tree (unordered).
   * Includes all nodes, not just roots.
   */
  nodes(): TreeNodeRef<DataShape>[] {
    return this.container.nodes().map(node => this.getOrCreateNodeRef(node))
  }

  /**
   * Get a node by its TreeID.
   *
   * @param id - The TreeID of the node to find
   * @returns The TreeNodeRef if found, undefined otherwise
   */
  getNodeByID(id: TreeID): TreeNodeRef<DataShape> | undefined {
    // Check cache first
    const cached = this.nodeCache.get(id)
    if (cached) return cached

    // Check if node exists in tree
    if (!this.container.has(id)) return undefined

    // Find the node in the tree's nodes
    const nodes = this.container.nodes()
    const node = nodes.find(n => n.id === id)
    if (!node) return undefined

    return this.getOrCreateNodeRef(node)
  }

  /**
   * Check if a node with the given ID exists in the tree.
   */
  has(id: TreeID): boolean {
    return this.container.has(id)
  }

  /**
   * Delete a node and all its descendants.
   * Also removes the node from the cache.
   *
   * @param target - The TreeID or TreeNodeRef to delete
   */
  delete(target: TreeID | TreeNodeRef<DataShape>): void {
    const id = typeof target === "string" ? target : target.id
    this.container.delete(id)
    // Remove from cache
    this.nodeCache.delete(id)
    this.commitIfAuto()
  }

  /**
   * Enable fractional index generation for ordering.
   *
   * @param jitter - Optional jitter value to avoid conflicts (0 = no jitter)
   */
  enableFractionalIndex(jitter = 0): void {
    this.container.enableFractionalIndex(jitter)
  }

  /**
   * Serialize the tree to a nested JSON structure.
   * Each node includes its data and children recursively.
   */
  toJSON(): TreeNodeJSON<DataShape>[] {
    // Use Loro's native toJSON which returns nested structure
    const nativeJson = this.container.toJSON() as any[]
    return this.transformNativeJson(nativeJson)
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

    const nativeJson = this.container.toJSON() as any[]
    flattenNodes(nativeJson)
    return result
  }
}
