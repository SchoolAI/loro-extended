/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import {
  Container,
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
} from "./schema.js"
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

// Draft Document class -- the actual object passed to the change `mutation` function
class DraftDoc<T extends DocShape> {
  topLevel!: { [K in keyof T["shape"]]: T["shape"][K] }

  constructor(
    private schema: T,
    private emptyState: InferPlainType<T>,
    private doc: LoroDoc,
  ) {
    this.createTopLevelProperties()
  }

  private createTopLevelProperties(): void {
    // Use a more direct approach that preserves type information
    for (const key in this.schema.shape) {
      const schemaValue = this.schema.shape[key]

      if (!(key in this.emptyState)) {
        throw new Error(`expected ${key} in emptyState`)
      }

      const node = createDraftNode(
        this.doc,
        [key],
        schemaValue,
        this.emptyState[key], // as InferPlainType<T["shape"][typeof key]>
      )

      ;(this as any)[key] = node
    }
  }

  absorbPlainValues(): void {
    for (const key in this.schema.shape) {
      const node = (this as any)[key] as DraftNode<any>
      node.absorbPlainValues()
    }
  }
}

// Base class for all draft nodes
abstract class DraftNode<T extends ContainerShape> {
  constructor(
    protected schema: T,
    protected emptyState: InferPlainType<T>,
    protected doc: LoroDoc,
    protected path: string[],
  ) {}

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
}

// Shared logic for list operations
abstract class ListDraftNodeBase<
  T extends ListContainerShape | MovableListContainerShape,
> extends DraftNode<T> {
  protected insertWithConversion(index: number, item: any): void {
    const convertedItem = convertInputToContainer(
      this.doc,
      item,
      this.schema.shape,
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
      this.schema.shape,
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
class MapDraftNode<T extends MapContainerShape> extends DraftNode<T> {
  private container: LoroMap | null = null
  private propertyCache = new Map<string, DraftNode<T> | Value>()

  constructor(
    protected schema: T,
    protected emptyState: InferPlainType<T>,
    protected doc: LoroDoc,
    protected path: string[],
  ) {
    super(schema, emptyState, doc, path)
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

  // Create property accessors for schema-defined keys
  createPropertyAccessors(): void {
    for (const [key, nestedSchema] of Object.entries(this.schema.shape)) {
      Object.defineProperty(this, key, {
        get: () => this.getNestedProperty(key, nestedSchema),
        set: isValueShape(nestedSchema)
          ? value => this.getContainer().set(key, value)
          : undefined,
        enumerable: true,
        configurable: true,
      })
    }
  }

  private getNestedProperty(
    key: string,
    nestedSchema: ContainerOrValueShape,
  ): DraftNode<T> | Value {
    if (this.propertyCache.has(key)) {
      return this.propertyCache.get(key)
    }

    const nestedPath = [...this.path, key]

    // It's a Loro container schema
    const result = createDraftNode(
      this.doc,
      nestedPath,
      nestedSchema,
      this.emptyState[key],
    )

    this.propertyCache.set(key, result)
    return result
  }

  set(key: string, value: Value): void {
    this.getContainer().set(key, value)
  }

  setContainer<C extends Container>(key: string, container: C): C {
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
function createDraftNode(
  doc: LoroDoc,
  path: string[],
  schema: ContainerOrValueShape,
  emptyState: any,
): DraftNode<ContainerShape> | any {
  if (isTextShape(schema)) {
    return new TextDraftNode(schema, emptyState, doc, path)
  }

  if (isCounterShape(schema)) {
    return new CounterDraftNode(schema, emptyState, doc, path)
  }

  if (isListShape(schema)) {
    return new ListDraftNode(schema, emptyState, doc, path)
  }

  if (isMovableListShape(schema)) {
    return new MovableListDraftNode(schema, emptyState, doc, path)
  }

  if (isMapShape(schema)) {
    return new MapDraftNode(schema, emptyState, doc, path)
  }

  if (isTreeShape(schema)) {
    return new TreeDraftNode(schema, emptyState, doc, path)
  }

  if (isValueShape(schema)) {
    return emptyState
  }

  throw new Error(
    `Unknown schema type: ${(schema as ContainerOrValueShape)._type}`,
  )
}

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<T extends DocShape> {
  constructor(
    private schema: T,
    private emptyState: InferPlainType<T>,
    private doc: LoroDoc = new LoroDoc(),
  ) {
    validateEmptyState(emptyState, schema)
  }

  get value(): InferPlainType<T> {
    const crdtValue = this.doc.toJSON()
    return overlayEmptyState(crdtValue, this.schema, this.emptyState)
  }

  change(fn: (draft: Draft<T>) => void): InferPlainType<T> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DraftDoc(this.schema, this.emptyState, this.doc)
    fn(draft as unknown as Draft<T>)
    draft.absorbPlainValues()
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
  emptyState: InferPlainType<T>,
  existingDoc?: LoroDoc,
): TypedDoc<T> {
  return new TypedDoc<T>(schema, emptyState, existingDoc || new LoroDoc())
}
