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
import { convertInputToNode } from "./conversion.js"
import { overlayEmptyState } from "./overlay.js"
import type {
  ContainerShape,
  CounterContainerShape,
  DocShape,
  Draft,
  InferPlainType,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  ShapeToContainer,
  TextContainerShape,
  TreeContainerShape,
  ValueShape,
} from "./shape.js"
import {
  isContainer,
  isContainerShape,
  isValueShape,
} from "./utils/type-guards.js"
import { validateEmptyState } from "./validation.js"

type DraftNodeParams<Shape extends DocShape | ContainerShape> = {
  doc: LoroDoc
  shape: Shape
  emptyState?: InferPlainType<Shape>
  getContainer: () => ShapeToContainer<Shape>
}

// Base class for all draft nodes
abstract class DraftNode<Shape extends DocShape | ContainerShape> {
  protected _cachedContainer?: ShapeToContainer<Shape>

  constructor(protected _params: DraftNodeParams<Shape>) {}

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

  protected get container(): ShapeToContainer<Shape> {
    if (!this._cachedContainer) {
      const container = this._params.getContainer()
      this._cachedContainer = container
      return container
    }
    return this._cachedContainer
  }
}

// Draft Document class -- the actual object passed to the change `mutation` function
class DraftDoc<Shape extends DocShape> extends DraftNode<Shape> {
  private propertyCache = new Map<string, DraftNode<Shape>>()
  private requiredEmptyState!: InferPlainType<Shape>

  constructor(_params: Omit<DraftNodeParams<Shape>, "getContainer">) {
    super({
      ..._params,
      getContainer: () => {
        throw new Error("can't get container on DraftDoc")
      },
    })
    if (!_params.emptyState) throw new Error("emptyState required")
    this.requiredEmptyState = _params.emptyState
    this.createLazyProperties()
  }

  createDraftNode<S extends ContainerShape>(
    key: string,
    nestedShape: S,
  ): DraftNode<any> {
    const doc = this.doc

    switch (nestedShape._type) {
      case "counter":
        return new CounterDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getCounter.bind(doc, key),
        })
      case "list":
        return new ListDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getList.bind(doc, key),
        })
      case "map":
        return new MapDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getMap.bind(doc, key),
        })
      case "movableList":
        return new MovableListDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getMovableList.bind(doc, key),
        })
      case "text":
        return new TextDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getText.bind(doc, key),
        })
      case "tree":
        return new TreeDraftNode({
          doc,
          shape: nestedShape,
          emptyState: this.requiredEmptyState[key],
          getContainer: doc.getTree.bind(doc, key),
        })
    }
  }

  getOrCreateNode(key: string, shape: ContainerShape): DraftNode<Shape> {
    let node = this.propertyCache.get(key)
    if (!node) {
      node = this.createDraftNode(key, shape)
      if (!node) throw new Error("no container made")
      this.propertyCache.set(key, node)
    }

    return node
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shape) {
      const shape = this.shape.shape[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
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
    const convertedItem = convertInputToNode(item, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.insertContainer(index, convertedItem)
    } else {
      this.container.insert(index, convertedItem)
    }
  }

  protected pushWithConversion(item: any): void {
    const convertedItem = convertInputToNode(item, this.shape.shape)
    if (isContainer(convertedItem)) {
      this.container.pushContainer(convertedItem)
    } else {
      this.container.push(convertedItem)
    }
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

  // Array-like methods for better developer experience
  find(predicate: (item: Shape, index: number) => boolean): Shape | undefined {
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

  // Abstract methods that subclasses must implement
  abstract get(index: number): any
  abstract get length(): number
}

// Text draft node
class TextDraftNode extends DraftNode<TextContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  // Text methods
  insert(index: number, content: string): void {
    this.container.insert(index, content)
  }

  delete(index: number, len: number): void {
    this.container.delete(index, len)
  }

  toString(): string {
    return this.container.toString()
  }

  update(text: string): void {
    this.container.update(text)
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.container.mark(range, key, value)
  }

  unmark(range: { start: number; end: number }, key: string): void {
    this.container.unmark(range, key)
  }

  toDelta(): any[] {
    return this.container.toDelta()
  }

  applyDelta(delta: any[]): void {
    this.container.applyDelta(delta)
  }

  get length(): number {
    return this.container.length
  }
}

// Counter draft node
class CounterDraftNode extends DraftNode<CounterContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  increment(value: number): void {
    this.container.increment(value)
  }

  decrement(value: number): void {
    this.container.decrement(value)
  }

  get value(): number {
    return this.container.value
  }
}

// List draft node
class ListDraftNode<
  Shape extends ListContainerShape,
> extends ListDraftNodeBase<Shape> {
  absorbPlainValues() {
    // TODO(duane): absorb array values
    // this.schema.shape
  }

  insert(index: number, item: InferPlainType<Shape>): void {
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.container.delete(index, len)
  }

  push(item: InferPlainType<Shape>): void {
    this.pushWithConversion(item)
  }

  pushContainer(container: Container): Container {
    return this.container.pushContainer(container)
  }

  insertContainer(index: number, container: Container): Container {
    return this.container.insertContainer(index, container)
  }

  get(index: number): any {
    return this.container.get(index)
  }

  get length(): number {
    return this.container.length
  }

  toArray(): any[] {
    return this.container.toArray()
  }
}

// MovableList draft node
class MovableListDraftNode<
  Shape extends MovableListContainerShape,
> extends ListDraftNodeBase<Shape> {
  absorbPlainValues() {
    // TODO(duane): absorb array values
    // this.schema.shape
  }

  insert(index: number, item: any): void {
    this.insertWithConversion(index, item)
  }

  delete(index: number, len: number): void {
    this.container.delete(index, len)
  }

  push(item: any): void {
    this.pushWithConversion(item)
  }

  set(index: number, item: any): void {
    this.container.set(index, item)
  }

  move(from: number, to: number): void {
    this.container.move(from, to)
  }

  get(index: number): any {
    return this.container.get(index)
  }

  get length(): number {
    return this.container.length
  }

  toArray(): any[] {
    return this.container.toArray()
  }
}

// Map draft node
class MapDraftNode extends DraftNode<MapContainerShape> {
  private propertyCache = new Map<string, DraftNode<ContainerShape> | Value>()

  constructor(params: DraftNodeParams<MapContainerShape>) {
    super(params)
    this.createLazyProperties()
  }

  absorbPlainValues() {
    for (const [key, node] of this.propertyCache.entries()) {
      if (node instanceof DraftNode) {
        // Contains a DraftNode, not a plain Value: keep recursing
        node.absorbPlainValues()
        continue
      }

      // Plain value!
      this.container.set(key, node)
    }
  }

  createContainerDraftNode<Shape extends ContainerShape>(
    key: string,
    nestedShape: Shape,
  ): DraftNode<ContainerShape> {
    const emptyState = this.emptyState?.[key]

    switch (nestedShape._type) {
      case "counter":
        return new CounterDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroCounter()),
        })
      case "list":
        return new ListDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroList()),
        })
      case "map":
        return new MapDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroMap()),
        })
      case "movableList":
        return new MovableListDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroMovableList()),
        })
      case "text":
        return new TextDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroText()),
        })
      case "tree":
        return new TreeDraftNode({
          doc: this.doc,
          shape: nestedShape,
          emptyState,
          getContainer: () =>
            this.container.getOrCreateContainer(key, new LoroTree()),
        })
    }
  }

  getOrCreateNode<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape: Shape,
  ): Shape extends ContainerShape ? DraftNode<Shape> : Value {
    let node = this.propertyCache.get(key)
    if (!node) {
      if (isContainerShape(shape)) {
        node = this.createContainerDraftNode(key, shape)
      } else {
        const emptyState = this.emptyState?.[key]
        if (!emptyState) throw new Error("empty state required")
        node = emptyState
      }
      if (!node) throw new Error("no container made")
      this.propertyCache.set(key, node)
    }

    return node as Shape extends ContainerShape ? DraftNode<Shape> : Value
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateNode(key, shape),
        set: isValueShape(shape)
          ? value => {
              console.log("set value", value)
              this.container.set(key, value)
            }
          : undefined,
      })
    }
  }

  get(key: string): any {
    return this.container.get(key)
  }

  set(key: string, value: Value): void {
    this.container.set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
    return this.container.setContainer(key, container)
  }

  delete(key: string): void {
    this.container.delete(key)
  }

  has(key: string): boolean {
    // LoroMap doesn't have a has method, so we check if get returns undefined
    return this.container.get(key) !== undefined
  }

  keys(): string[] {
    return this.container.keys()
  }

  values(): any[] {
    return this.container.values()
  }

  get size(): number {
    return this.container.size
  }
}

// Tree draft node
class TreeDraftNode<T extends TreeContainerShape> extends DraftNode<T> {
  absorbPlainValues() {
    // TODO(duane): implement for trees
  }

  createNode(parent?: any, index?: number): any {
    return this.container.createNode(parent, index)
  }

  move(target: any, parent?: any, index?: number): void {
    this.container.move(target, parent, index)
  }

  delete(target: any): void {
    this.container.delete(target)
  }

  has(target: any): boolean {
    return this.container.has(target)
  }

  getNodeByID(id: any): any {
    return this.container.getNodeByID
      ? this.container.getNodeByID(id)
      : undefined
  }
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
    console.log("crdtValue", crdtValue)
    console.log("emptyState", this.emptyState)
    return overlayEmptyState(
      this.shape,
      crdtValue,
      this.emptyState,
    ) as InferPlainType<Shape>
  }

  change(fn: (draft: Draft<Shape>) => void): InferPlainType<Shape> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DraftDoc({
      shape: this.shape,
      emptyState: this.emptyState,
      doc: this.doc,
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
