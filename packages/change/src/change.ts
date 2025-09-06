/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import {
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
} from "loro-crdt"
import { create } from "mutative"
import { convertInputToContainer } from "./conversion.js"
import { overlayEmptyState } from "./overlay.js"
import type { DocShape, Draft, InferInputType } from "./schema.js"
import { isContainer } from "./utils/type-guards.js"
import { validateEmptyState } from "./validation.js"

// Helper functions for POJO mutation support
/**
 * Extracts the initial value for a POJO property from the empty state
 * by traversing the path to find the corresponding value
 */
function getEmptyStateValueForPath(
  emptyState: any,
  path: string[],
  key: string,
): any {
  let current = emptyState

  // Navigate through the path to find the parent object
  for (const segment of path) {
    if (current && typeof current === "object" && segment in current) {
      current = current[segment]
    } else {
      return undefined
    }
  }

  // Return the value for the specific key
  return current && typeof current === "object" ? current[key] : undefined
}

// Base class for all draft nodes
abstract class DraftNode {
  constructor(
    protected doc: LoroDoc,
    protected path: string[],
    protected schema: any,
  ) {}

  abstract getContainer(): any

  protected getParentContainer(parentPath: string[]): LoroMap {
    if (parentPath.length === 1) {
      return this.doc.getMap(parentPath[0])
    } else {
      const grandParentPath = parentPath.slice(0, -1)
      const parentKey = parentPath[parentPath.length - 1]
      const grandParent = this.getParentContainer(grandParentPath)
      return grandParent.getOrCreateContainer(parentKey, new LoroMap())
    }
  }
}

// Shared logic for list operations
abstract class ListDraftNodeBase extends DraftNode {
  protected insertWithConversion(index: number, item: any): void {
    const convertedItem = convertInputToContainer(
      this.doc,
      item,
      this.schema.item,
      this.path,
    )
    if (isContainer(convertedItem)) {
      this.getContainer().insertContainer(index, convertedItem)
    } else {
      this.getContainer().insert(index, convertedItem)
    }
  }

  protected pushWithConversion(item: any): void {
    const convertedItem = convertInputToContainer(
      this.doc,
      item,
      this.schema.item,
      this.path,
    )
    if (isContainer(convertedItem)) {
      this.getContainer().pushContainer(convertedItem)
    } else {
      this.getContainer().push(convertedItem)
    }
  }
}

// Text draft node
class TextDraftNode extends DraftNode {
  private container: LoroText | null = null

  getContainer(): LoroText {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroText
    }
    return this.container
  }

  private getOrCreateContainer(): LoroText {
    if (this.path.length === 1) {
      return this.doc.getText(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap

      // Use getOrCreateContainer to get a stable reference directly
      return parent.getOrCreateContainer(key, new LoroText())
    }
  }

  // Text methods
  insert(index: number, content: string): void {
    this.getContainer().insert(index, content)
  }

  delete(index: number, len: number): void {
    this.getContainer().delete(index, len)
  }

  toString(): string {
    return this.getContainer().toString()
  }

  update(text: string): void {
    this.getContainer().update(text)
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.getContainer().mark(range, key, value)
  }

  unmark(range: { start: number; end: number }, key: string): void {
    this.getContainer().unmark(range, key)
  }

  toDelta(): any[] {
    return this.getContainer().toDelta()
  }

  applyDelta(delta: any[]): void {
    this.getContainer().applyDelta(delta)
  }

  get length(): number {
    return this.getContainer().length
  }
}

// Counter draft node
class CounterDraftNode extends DraftNode {
  private container: LoroCounter | null = null

  getContainer(): LoroCounter {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroCounter
    }
    return this.container
  }

  private getOrCreateContainer(): LoroCounter {
    if (this.path.length === 1) {
      return this.doc.getCounter(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap

      // Use getOrCreateContainer to get a stable reference directly
      return parent.getOrCreateContainer(key, new LoroCounter())
    }
  }

  increment(value: number): void {
    this.getContainer().increment(value)
  }

  decrement(value: number): void {
    this.getContainer().decrement(value)
  }

  get value(): number {
    return this.getContainer().value
  }
}

// List draft node
class ListDraftNode extends ListDraftNodeBase {
  private container: LoroList | null = null

  getContainer(): LoroList {
    if (!this.container) {
      this.container = this.getOrCreateContainer()
    }
    return this.container
  }

  private getOrCreateContainer(): LoroList {
    if (this.path.length === 1) {
      return this.doc.getList(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap
      return parent.getOrCreateContainer(key, new LoroList())
    }
  }

  insert(index: number, item: any): void {
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.getContainer().delete(index, len)
  }

  push(item: any): void {
    this.pushWithConversion(item)
  }

  pushContainer(container: any): any {
    return this.getContainer().pushContainer(container)
  }

  insertContainer(index: number, container: any): any {
    return this.getContainer().insertContainer(index, container)
  }

  get(index: number): any {
    return this.getContainer().get(index)
  }

  get length(): number {
    return this.getContainer().length
  }

  toArray(): any[] {
    return this.getContainer().toArray()
  }
}

// MovableList draft node
class MovableListDraftNode extends ListDraftNodeBase {
  private container: LoroMovableList | null = null

  getContainer(): LoroMovableList {
    if (!this.container) {
      this.container = this.getOrCreateContainer()
    }
    return this.container
  }

  private getOrCreateContainer(): LoroMovableList {
    if (this.path.length === 1) {
      return this.doc.getMovableList(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap
      return parent.getOrCreateContainer(key, new LoroMovableList())
    }
  }

  insert(index: number, item: any): void {
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.getContainer().delete(index, len)
  }

  push(item: any): void {
    this.pushWithConversion(item)
  }

  set(index: number, item: any): void {
    this.getContainer().set(index, item)
  }

  move(from: number, to: number): void {
    this.getContainer().move(from, to)
  }

  get(index: number): any {
    return this.getContainer().get(index)
  }

  get length(): number {
    return this.getContainer().length
  }

  toArray(): any[] {
    return this.getContainer().toArray()
  }
}

// Map draft node
class MapDraftNode extends DraftNode {
  private container: LoroMap | null = null
  private propertyCache = new Map<string, any>()

  /**
   * Sets the empty state context for this map node
   * This allows the update method to access empty state values
   */
  setEmptyStateContext(emptyState: any): void {
    // Store empty state value for this specific path
    const emptyStateForPath = getEmptyStateValueForPath(
      emptyState,
      this.path.slice(0, -1),
      this.path[this.path.length - 1],
    )
    this.emptyStateForPath = emptyStateForPath
  }

  private emptyStateForPath: any = undefined

  getContainer(): LoroMap {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroMap
    }
    return this.container
  }

  private getOrCreateContainer(): LoroMap {
    if (this.path.length === 1) {
      return this.doc.getMap(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap

      // Use getOrCreateContainer to get a stable reference directly
      return parent.getOrCreateContainer(key, new LoroMap())
    }
  }

  // Create property accessors for schema-defined keys
  createPropertyAccessors(): void {
    if (!this.schema.shape) return

    for (const [key, nestedSchema] of Object.entries(this.schema.shape)) {
      Object.defineProperty(this, key, {
        get: () => this.getNestedProperty(key, nestedSchema),
        enumerable: true,
        configurable: true,
      })
    }
  }

  private getNestedProperty(key: string, nestedSchema: any): any {
    if (this.propertyCache.has(key)) {
      return this.propertyCache.get(key)
    }

    const nestedPath = [...this.path, key]
    let result: any

    if (
      nestedSchema &&
      typeof nestedSchema === "object" &&
      "_type" in nestedSchema
    ) {
      // It's a Loro container schema
      result = createDraftNode(this.doc, nestedPath, nestedSchema)
    } else {
      // It's a Zod schema (POJO) - return a getter/setter object
      // But we need to make this work with direct property assignment
      const container = this.getContainer()
      result = {
        get value() {
          return container.get(key)
        },
        set value(val: any) {
          container.set(key, val)
        },
        // Make it work with direct assignment by overriding valueOf
        valueOf() {
          return container.get(key)
        },
        toString() {
          return String(container.get(key))
        },
      }
    }

    this.propertyCache.set(key, result)
    return result
  }

  /**
   * Update the entire map using mutative for type-safe nested mutations
   * This provides natural object access: draft.articles.update(draft => { draft.metadata.views.published = true })
   *
   * @param mutator - Function that receives the current map state and can mutate it
   * @returns The updated map state
   */
  update<T = any>(mutator: (draft: T) => void): T {
    // Get current state of the entire map, with empty state fallback
    const currentState = this.getCurrentMapState()

    // Use mutative to create a new version with the mutations applied
    const updatedState = create(currentState, draft => {
      mutator(draft as T)
    })

    // Apply changes back to the CRDT by comparing old vs new state
    this.applyChangesToCrdt(currentState, updatedState)

    return updatedState as T
  }

  /**
   * Gets the current state of the entire map, including values from all keys
   * Falls back to empty state values for missing keys
   */
  private getCurrentMapState(): any {
    const container = this.getContainer()
    const result: any = {}

    // Start with empty state if available
    if (this.emptyStateForPath && typeof this.emptyStateForPath === "object") {
      Object.assign(result, this.emptyStateForPath)
    }

    // Override with actual CRDT values
    const keys = container.keys()
    for (const key of keys) {
      result[key] = container.get(key)
    }

    return result
  }

  /**
   * Applies changes from the mutative result back to the CRDT
   * Only updates keys that have actually changed
   */
  private applyChangesToCrdt(oldState: any, newState: any): void {
    const container = this.getContainer()

    // Find all keys in the new state
    const allKeys = new Set([
      ...Object.keys(oldState || {}),
      ...Object.keys(newState || {}),
    ])

    // Update each key that has changed
    for (const key of allKeys) {
      const oldValue = oldState?.[key]
      const newValue = newState?.[key]

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        if (newValue === undefined) {
          container.delete(key)
        } else {
          container.set(key, newValue)
        }
      }
    }
  }

  set(key: string, value: any): void {
    this.getContainer().set(key, value)
  }

  setContainer(key: string, container: any): any {
    return this.getContainer().setContainer(key, container)
  }

  get(key: string): any {
    return this.getContainer().get(key)
  }

  delete(key: string): void {
    this.getContainer().delete(key)
  }

  has(key: string): boolean {
    // LoroMap doesn't have a has method, so we check if get returns undefined
    return this.getContainer().get(key) !== undefined
  }

  keys(): string[] {
    return this.getContainer().keys()
  }

  values(): any[] {
    return this.getContainer().values()
  }

  get size(): number {
    return this.getContainer().size
  }
}

// Tree draft node
class TreeDraftNode extends DraftNode {
  private container: LoroTree | null = null

  getContainer(): LoroTree {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroTree
    }
    return this.container
  }

  private getOrCreateContainer(): LoroTree {
    if (this.path.length === 1) {
      return this.doc.getTree(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath) as LoroMap

      // Use getOrCreateContainer to get a stable reference directly
      return parent.getOrCreateContainer(key, new LoroTree())
    }
  }

  createNode(parent?: any, index?: number): any {
    return this.getContainer().createNode(parent, index)
  }

  move(target: any, parent?: any, index?: number): void {
    this.getContainer().move(target, parent, index)
  }

  delete(target: any): void {
    this.getContainer().delete(target)
  }

  has(target: any): boolean {
    return this.getContainer().has(target)
  }

  getNodeByID(id: any): any {
    return this.getContainer().getNodeByID
      ? this.getContainer().getNodeByID(id)
      : undefined
  }
}

// Factory function to create appropriate draft node
function createDraftNode(doc: LoroDoc, path: string[], schema: any): DraftNode {
  if (!schema || typeof schema !== "object" || !("_type" in schema)) {
    throw new Error(
      `Invalid schema for path ${path.join(".")}: ${JSON.stringify(schema)}`,
    )
  }

  switch (schema._type) {
    case "text":
      return new TextDraftNode(doc, path, schema)
    case "counter":
      return new CounterDraftNode(doc, path, schema)
    case "list":
      return new ListDraftNode(doc, path, schema)
    case "movableList":
      return new MovableListDraftNode(doc, path, schema)
    case "map": {
      const node = new MapDraftNode(doc, path, schema)
      // Create property accessors for map nodes
      if (node instanceof MapDraftNode) {
        node.createPropertyAccessors()
      }
      return node
    }
    case "tree":
      return new TreeDraftNode(doc, path, schema)
    default:
      throw new Error(`Unknown schema type: ${schema._type}`)
  }
}

// Document draft class
class DocumentDraft {
  constructor(
    private doc: LoroDoc,
    private schema: DocShape,
    private emptyState?: any,
  ) {
    this.createTopLevelProperties()
  }

  private createTopLevelProperties(): void {
    for (const [key, schemaValue] of Object.entries(this.schema.shape)) {
      Object.defineProperty(this, key, {
        get: () => {
          const node = createDraftNode(this.doc, [key], schemaValue)
          // Set empty state context for MapDraftNode instances
          if (node instanceof MapDraftNode && this.emptyState) {
            node.setEmptyStateContext(this.emptyState)
          }
          return node
        },
        enumerable: true,
        configurable: true,
      })
    }
  }
}

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<T extends DocShape> {
  constructor(
    private schema: T,
    private emptyState: InferInputType<T>,
    private doc: LoroDoc = new LoroDoc(),
  ) {
    validateEmptyState(emptyState, schema)
  }

  get value(): InferInputType<T> {
    const crdtValue = this.doc.toJSON()
    return overlayEmptyState(crdtValue, this.schema, this.emptyState)
  }

  change(fn: (draft: Draft<T>) => void): InferInputType<T> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DocumentDraft(this.doc, this.schema, this.emptyState)
    fn(draft as unknown as Draft<T>)
    this.doc.commit()
    return this.value
  }

  // Expose underlying doc for advanced use cases
  get loroDoc(): LoroDoc {
    return this.doc
  }

  // Expose schema for internal use
  get docSchema(): T {
    return this.schema
  }

  // Get raw CRDT value without overlay
  get rawValue(): any {
    return this.doc.toJSON()
  }
}

// Factory function for TypedLoroDoc
export function createTypedDoc<T extends DocShape>(
  schema: T,
  emptyState: InferInputType<T>,
  existingDoc?: LoroDoc,
): TypedDoc<T> {
  return new TypedDoc<T>(schema, emptyState, existingDoc || new LoroDoc())
}
