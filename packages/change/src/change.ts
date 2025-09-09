/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import {
  type Container,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  type Value,
} from "loro-crdt"
import { convertInputToContainer } from "./conversion.js"
import { overlayEmptyState } from "./overlay.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  CounterContainerShape,
  DocShape,
  Draft,
  InferPlainType,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  TextContainerShape,
  TreeContainerShape,
} from "./shape.js"
import {
  isContainer,
  isCounterShape,
  isListShape,
  isMapShape,
  isMovableListShape,
  isTextShape,
  isTreeShape,
  isValueShape,
} from "./utils/type-guards.js"
import { validateEmptyState } from "./validation.js"

interface DraftNodeParams<Shape extends DocShape | ContainerShape> {
  doc: LoroDoc
  shape: Shape
  emptyState?: InferPlainType<Shape>
  path: string[]
}

// Base class for all draft nodes
abstract class DraftNode<Shape extends DocShape | ContainerShape> {
  constructor(protected _params: DraftNodeParams<Shape>) {}

  abstract getContainer(): any

  abstract absorbPlainValues(): void

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

  protected get doc(): LoroDoc {
    return this._params.doc
  }

  protected get shape(): Shape {
    return this._params.shape
  }

  protected get emptyState(): InferPlainType<Shape> | undefined {
    return this._params.emptyState
  }

  protected get path(): string[] {
    return this._params.path
  }
}

// Draft Document class -- the actual object passed to the change `mutation` function
class DraftDoc<Shape extends DocShape> extends DraftNode<Shape> {
  private propertyCache = new Map<string, DraftNode<Shape>>()
  private requiredEmptyState!: InferPlainType<Shape>

  constructor(_params: DraftNodeParams<Shape>) {
    super(_params)
    if (!_params.emptyState) throw new Error("emptyState required")
    this.requiredEmptyState = _params.emptyState
    this.createLazyProperties()
  }

  getContainer() {
    throw new Error("not implemented")
  }

  getOrCreateContainer(key: string, shape: ContainerShape) {
    let container = this.propertyCache.get(key)
    if (!container) {
      container = createDraftNode({
        doc: this.doc,
        shape,
        emptyState: this.requiredEmptyState[key],
        path: [key],
      })
      if (!container) throw new Error("no container made")
      this.propertyCache.set(key, container)
    }

    return container
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shape) {
      const shape = this.shape.shape[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateContainer(key, shape),
      })
    }
  }

  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const node of this.propertyCache.values()) {
      node.absorbPlainValues()
    }
  }
}

// Shared logic for list operations
abstract class ListDraftNodeBase<
  Shape extends ListContainerShape | MovableListContainerShape,
> extends DraftNode<Shape> {
  protected insertWithConversion(index: number, item: any): void {
    const convertedItem = convertInputToContainer(
      this.doc,
      item,
      this.shape.shape,
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
      this.shape.shape,
      this.path,
    )
    if (isContainer(convertedItem)) {
      this.getContainer().pushContainer(convertedItem)
    } else {
      this.getContainer().push(convertedItem)
    }
  }

  // Array-like methods for better developer experience
  find<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): ItemType | undefined {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return item
      }
    }
    return undefined
  }

  findIndex<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): number {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return i
      }
    }
    return -1
  }

  map<ItemType = any, ReturnType = any>(
    callback: (item: ItemType, index: number) => ReturnType,
  ): ReturnType[] {
    const result: ReturnType[] = []
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      result.push(callback(item, i))
    }
    return result
  }

  filter<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): ItemType[] {
    const result: ItemType[] = []
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        result.push(item)
      }
    }
    return result
  }

  forEach<ItemType = any>(
    callback: (item: ItemType, index: number) => void,
  ): void {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      callback(item, i)
    }
  }

  some<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): boolean {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (predicate(item, i)) {
        return true
      }
    }
    return false
  }

  every<ItemType = any>(
    predicate: (item: ItemType, index: number) => boolean,
  ): boolean {
    for (let i = 0; i < this.length; i++) {
      const item = this.getDraftItem(i)
      if (!predicate(item, i)) {
        return false
      }
    }
    return true
  }

  // Get the appropriate item for array methods - either draft container or plain value
  protected getDraftItem(index: number): any {
    // For container shapes, we need to return the draft container object
    // For value shapes, we return the plain value
    if (isValueShape(this.shape.shape)) {
      return this.get(index) // Plain value
    } else {
      // Container shape - create/get the draft node
      const itemPath = [...this.path, index.toString()]
      return createDraftNode({
        doc: this.doc,
        shape: this.shape.shape,
        path: itemPath,
        // No empty state for individual list items, they must be fully specified
      })
    }
  }

  // Abstract methods that subclasses must implement
  abstract get(index: number): any
  abstract get length(): number
}

// Text draft node
class TextDraftNode extends DraftNode<TextContainerShape> {
  private container: LoroText | null = null

  getContainer(): LoroText {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroText
    }
    return this.container
  }

  absorbPlainValues() {
    // no plain values contained within
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
class CounterDraftNode extends DraftNode<CounterContainerShape> {
  private container: LoroCounter | null = null

  getContainer(): LoroCounter {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroCounter
    }
    return this.container
  }

  absorbPlainValues() {
    // no plain values contained within
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
class ListDraftNode<T extends ListContainerShape> extends ListDraftNodeBase<T> {
  private container: LoroList | null = null

  getContainer(): LoroList {
    if (!this.container) {
      this.container = this.getOrCreateContainer()
    }
    return this.container
  }

  absorbPlainValues() {
    // TODO(duane): absorb array values
    // this.schema.shape
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
class MovableListDraftNode<
  T extends MovableListContainerShape,
> extends ListDraftNodeBase<T> {
  private container: LoroMovableList | null = null

  getContainer(): LoroMovableList {
    if (!this.container) {
      this.container = this.getOrCreateContainer()
    }
    return this.container
  }

  absorbPlainValues() {
    // TODO(duane): absorb array values
    // this.schema.shape
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
class MapDraftNode<Shape extends MapContainerShape> extends DraftNode<Shape> {
  private container: LoroMap | null = null
  private propertyCache = new Map<string, DraftNode<Shape> | Value>()

  constructor(params: DraftNodeParams<Shape>) {
    super(params)
    this.createPropertyAccessors()
  }

  getContainer(): LoroMap {
    if (!this.container) {
      this.container = this.getOrCreateContainer()
    }
    return this.container
  }

  absorbPlainValues() {
    for (const [key, node] of this.propertyCache.entries()) {
      if (node instanceof DraftNode) {
        // Contains a DraftNode, not a plain Value: keep recursing
        node.absorbPlainValues()
        continue
      }

      // Plain value!
      this.getContainer().set(key, node)
    }
  }

  private getOrCreateContainer(): LoroMap {
    if (this.path.length === 1) {
      return this.doc.getMap(this.path[0])
    } else {
      const parentPath = this.path.slice(0, -1)
      const key = this.path[this.path.length - 1]
      const parent = this.getParentContainer(parentPath)

      // Use getOrCreateContainer to get a stable reference directly
      return parent.getOrCreateContainer(key, new LoroMap())
    }
  }

  // Create property accessors for shape-defined keys
  createPropertyAccessors(): void {
    for (const [key, nestedShape] of Object.entries(this.shape.shape)) {
      Object.defineProperty(this, key, {
        get: () => this.getNestedProperty(key, nestedShape),
        set: isValueShape(nestedShape)
          ? value => this.getContainer().set(key, value)
          : undefined,
        enumerable: true,
        configurable: true,
      })
    }
  }

  private getNestedProperty(
    key: string,
    nestedShape: ContainerOrValueShape,
  ): DraftNode<Shape> | Value {
    if (this.propertyCache.has(key)) {
      return this.propertyCache.get(key)
    }

    const nestedPath = [...this.path, key]
    const emptyState = this.emptyState?.[key]

    // Check if we're accessing existing state vs creating new state
    // If the container already has this key, we don't need emptyState
    const containerHasKey = this.getContainer().get(key) !== undefined

    // Only require emptyState when creating new state for container shapes
    if (!containerHasKey && !emptyState && !isValueShape(nestedShape)) {
      throw new Error(
        `Map property '${key}' requires emptyState when container doesn't exist`,
      )
    }

    // Create the draft node - emptyState can be undefined for existing containers
    const result = createDraftNode({
      doc: this.doc,
      shape: nestedShape,
      path: nestedPath,
      emptyState,
    })

    this.propertyCache.set(key, result)
    return result
  }

  get(key: string): any {
    return this.getContainer().get(key)
  }

  set(key: string, value: Value): void {
    this.getContainer().set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
    return this.getContainer().setContainer(key, container)
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
class TreeDraftNode<T extends TreeContainerShape> extends DraftNode<T> {
  private container: LoroTree | null = null

  getContainer(): LoroTree {
    if (!this.container) {
      this.container = this.getOrCreateContainer() as LoroTree
    }
    return this.container
  }

  absorbPlainValues() {
    // TODO(duane): implement for trees
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
function createDraftNode<Shape extends ContainerOrValueShape>({
  doc,
  path,
  shape,
  emptyState,
}: {
  doc: LoroDoc
  path: string[]
  shape: Shape
  emptyState?: InferPlainType<Shape>
}): DraftNode<ContainerShape> | InferPlainType<Shape> | undefined {
  if (isTextShape(shape)) {
    return new TextDraftNode({ doc, shape, path, emptyState })
  }

  if (isCounterShape(shape)) {
    return new CounterDraftNode({ doc, shape, path, emptyState })
  }

  if (isListShape(shape)) {
    return new ListDraftNode({ doc, shape, path, emptyState })
  }

  if (isMovableListShape(shape)) {
    return new MovableListDraftNode({ doc, shape, path, emptyState })
  }

  if (isMapShape(shape)) {
    return new MapDraftNode({ doc, shape, path, emptyState })
  }

  if (isTreeShape(shape)) {
    return new TreeDraftNode({ doc, shape, path, emptyState })
  }

  if (isValueShape(shape)) {
    return emptyState
  }

  throw new Error(
    `Unknown shape type: ${(shape as ContainerOrValueShape)._type}`,
  )
}

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<Shape extends DocShape> {
  constructor(
    private shape: Shape,
    private emptyState: InferPlainType<Shape>,
    private doc: LoroDoc = new LoroDoc(),
  ) {
    validateEmptyState(emptyState, shape)
  }

  get value(): InferPlainType<Shape> {
    const crdtValue = this.doc.toJSON()
    return overlayEmptyState(crdtValue, this.shape, this.emptyState)
  }

  change(fn: (draft: Draft<Shape>) => void): InferPlainType<Shape> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DraftDoc({
      shape: this.shape,
      emptyState: this.emptyState,
      doc: this.doc,
      path: [],
    })
    fn(draft as unknown as Draft<Shape>)
    draft.absorbPlainValues()
    this.doc.commit()
    return this.value
  }

  // Expose underlying doc for advanced use cases
  get loroDoc(): LoroDoc {
    return this.doc
  }

  // Expose shape for internal use
  get docShape(): Shape {
    return this.shape
  }

  // Get raw CRDT value without overlay
  get rawValue(): any {
    return this.doc.toJSON()
  }
}

// Factory function for TypedLoroDoc
export function createTypedDoc<Shape extends DocShape>(
  shape: Shape,
  emptyState: InferPlainType<Shape>,
  existingDoc?: LoroDoc,
): TypedDoc<Shape> {
  return new TypedDoc<Shape>(shape, emptyState, existingDoc || new LoroDoc())
}
