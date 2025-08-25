import {
  type Container,
  type ExportMode,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroText,
} from "loro-crdt"
import { create, type Patch } from "mutative"

// #################
// ### TEA Integration Types
// #################

/**
 * Custom patch type for CRDT operations that preserves semantic meaning
 */
export interface CRDTPatch {
  op: "crdt"
  path: string[]
  method: string
  args: unknown[]
  crdtType: "counter" | "text" | "map" | "list"
  timestamp: number
}

/**
 * Combined patch type that includes both mutative and CRDT patches
 */
export type CombinedPatch = Patch | CRDTPatch

/**
 * Options for the change function
 */
export interface ChangeOptions {
  enablePatches?: boolean
}

// #################
// ### ExtendedLoroDoc
// #################

/**
 * ExtendedLoroDoc wraps a LoroDoc to provide a cleaner API that hides the internal "doc" map.
 * It provides convenient methods for casual users while exposing the underlying LoroDoc for advanced use cases.
 */
export class ExtendedLoroDoc<T = any> {
  private _doc: LoroDoc

  constructor(doc?: LoroDoc) {
    this._doc = doc || new LoroDoc()
  }

  /**
   * Returns the data as clean JSON without the "doc" wrapper.
   */
  toJSON(): T {
    const json = this._doc.toJSON()
    return (json.doc as T) || ({} as T)
  }

  /**
   * Provides direct access to the underlying LoroDoc for advanced operations.
   */
  get doc(): LoroDoc {
    return this._doc
  }

  /**
   * Commits any pending changes to the document.
   */
  commit(): void {
    this._doc.commit()
  }

  /**
   * Exports the document as a binary snapshot.
   */
  export(mode: ExportMode = { mode: "snapshot" }): Uint8Array {
    return this._doc.export(mode)
  }

  /**
   * Imports a binary snapshot into the document.
   */
  import(data: Uint8Array): void {
    this._doc.import(data)
  }

  /**
   * Gets the root map container (for compatibility with existing tests).
   */
  getMap(name: string): LoroMap {
    return this._doc.getMap(name)
  }

  /**
   * Creates an ExtendedLoroDoc from an exported binary snapshot.
   *
   * biome-ignore lint/suspicious/useAdjacentOverloadSignatures: import is legit
   */
  static import<T>(data: Uint8Array): ExtendedLoroDoc<T> {
    const doc = new LoroDoc()
    doc.import(data)
    return new ExtendedLoroDoc<T>(doc)
  }

  /**
   * Wraps an existing LoroDoc in an ExtendedLoroDoc.
   */
  static wrap<T>(doc: LoroDoc): ExtendedLoroDoc<T> {
    return new ExtendedLoroDoc<T>(doc)
  }

  /**
   * Unwraps an ExtendedLoroDoc to get the underlying LoroDoc.
   */
  static unwrap<T>(extendedDoc: ExtendedLoroDoc<T>): LoroDoc {
    return extendedDoc.doc
  }
}

// #################
// ### CRDT Wrappers
// #################

class LoroTextWrapper {
  constructor(public initialValue: string) {}
}

class LoroCounterWrapper {
  constructor(public initialValue: number) {}
}

export const CRDT = {
  Text: (initialValue = "") => new LoroTextWrapper(initialValue),
  Counter: (initialValue = 0) => new LoroCounterWrapper(initialValue),
}

// #################
// ### Types
// #################

export type AsLoro<T> = T extends LoroTextWrapper
  ? LoroText
  : T extends LoroCounterWrapper
    ? LoroCounter
    : T extends (infer E)[]
      ? AsLoro<E>[]
      : T extends Record<string, unknown>
        ? { [K in keyof T]: AsLoro<T[K]> }
        : T

/**
 * @hidden
 * A utility type to extract the optional keys from a type T.
 */
type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never
}[keyof T]

/**
 * @hidden
 * A utility type that enforces a type `T` to have no optional properties.
 */
type NoOptional<T> = [OptionalKeys<T>] extends [never]
  ? T
  : "Error: Optional properties are not supported. Use 'T | null' instead."

// #################
// ### Simplified CRDT Integration
// #################

/**
 * @hidden
 * Injects CRDT proxies into a plain JavaScript state object
 */
function injectCRDTProxies(
  state: any,
  loroContainer: LoroMap | LoroList,
  patches: CRDTPatch[],
  path: string[] = [],
): any {
  if (state === null || typeof state !== "object") {
    return state
  }

  if (Array.isArray(state)) {
    return state.map((item, index) => {
      if (loroContainer instanceof LoroList) {
        const loroItem = loroContainer.get(index)
        if (loroItem instanceof LoroCounter) {
          return createCounterProxy(loroItem, [...path, String(index)], patches)
        }
        if (loroItem instanceof LoroText) {
          return createTextProxy(loroItem, [...path, String(index)], patches)
        }
        if (loroItem instanceof LoroMap || loroItem instanceof LoroList) {
          return injectCRDTProxies(item, loroItem, patches, [
            ...path,
            String(index),
          ])
        }
      }
      return item
    })
  }

  const result: any = {}
  for (const [key, value] of Object.entries(state)) {
    if (loroContainer instanceof LoroMap) {
      const loroValue = loroContainer.get(key)
      if (loroValue instanceof LoroCounter) {
        result[key] = createCounterProxy(loroValue, [...path, key], patches)
      } else if (loroValue instanceof LoroText) {
        result[key] = createTextProxy(loroValue, [...path, key], patches)
      } else if (
        loroValue instanceof LoroMap ||
        loroValue instanceof LoroList
      ) {
        result[key] = injectCRDTProxies(value, loroValue, patches, [
          ...path,
          key,
        ])
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * @hidden
 * Creates a counter proxy that captures increment/decrement operations
 */
function createCounterProxy(
  counter: LoroCounter,
  path: string[],
  patches: CRDTPatch[],
): LoroCounter {
  return new Proxy(counter, {
    get(target, prop) {
      if (prop === "increment") {
        return (amount: number = 1) => {
          patches.push({
            op: "crdt",
            path,
            method: "increment",
            args: [amount],
            crdtType: "counter",
            timestamp: Date.now(),
          })
          return target.increment(amount)
        }
      }

      if (prop === "decrement") {
        return (amount: number = 1) => {
          patches.push({
            op: "crdt",
            path,
            method: "decrement",
            args: [amount],
            crdtType: "counter",
            timestamp: Date.now(),
          })
          return target.decrement(amount)
        }
      }

      return Reflect.get(target, prop)
    },
  })
}

/**
 * @hidden
 * Creates a text proxy that captures insert/delete operations
 */
function createTextProxy(
  text: LoroText,
  path: string[],
  patches: CRDTPatch[],
): LoroText {
  return new Proxy(text, {
    get(target, prop) {
      if (prop === "insert") {
        return (pos: number, content: string) => {
          patches.push({
            op: "crdt",
            path,
            method: "insert",
            args: [pos, content],
            crdtType: "text",
            timestamp: Date.now(),
          })
          return target.insert(pos, content)
        }
      }

      if (prop === "delete") {
        return (pos: number, len: number) => {
          patches.push({
            op: "crdt",
            path,
            method: "delete",
            args: [pos, len],
            crdtType: "text",
            timestamp: Date.now(),
          })
          return target.delete(pos, len)
        }
      }

      return Reflect.get(target, prop)
    },
  })
}

/**
 * @hidden
 * Applies a new state to the LoroDoc by converting JS values to Loro containers
 */
function applyStateToLoroDoc<T>(doc: ExtendedLoroDoc<T>, newState: any): void {
  const rootMap = doc.getMap("doc")

  // Clear existing state
  for (const key of rootMap.keys()) {
    rootMap.delete(key)
  }

  // Apply new state
  for (const [key, value] of Object.entries(newState)) {
    const loroValue = toLoroValue(value)
    if (
      loroValue instanceof LoroMap ||
      loroValue instanceof LoroList ||
      loroValue instanceof LoroText ||
      loroValue instanceof LoroCounter
    ) {
      rootMap.setContainer(key, loroValue as Container)
    } else {
      rootMap.set(key, loroValue)
    }
  }
}

/**
 * @hidden
 * Converts a JavaScript value to a Loro-compatible value.
 */
function toLoroValue(value: unknown): unknown {
  if (value instanceof LoroTextWrapper) {
    const text = new LoroText()
    text.insert(0, value.initialValue)
    return text
  }

  if (value instanceof LoroCounterWrapper) {
    const counter = new LoroCounter()
    counter.increment(value.initialValue)
    return counter
  }

  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    const list = new LoroList()
    for (const item of value) {
      const loroItem = toLoroValue(item)
      if (
        loroItem instanceof LoroMap ||
        loroItem instanceof LoroList ||
        loroItem instanceof LoroText ||
        loroItem instanceof LoroCounter
      ) {
        list.pushContainer(loroItem as Container)
      } else {
        list.push(loroItem)
      }
    }
    return list
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    const map = new LoroMap()
    for (const [key, subValue] of Object.entries(value)) {
      const loroSubValue = toLoroValue(subValue)
      if (
        loroSubValue instanceof LoroMap ||
        loroSubValue instanceof LoroList ||
        loroSubValue instanceof LoroText ||
        loroSubValue instanceof LoroCounter
      ) {
        map.setContainer(key, loroSubValue as Container)
      } else {
        map.set(key, loroSubValue)
      }
    }
    return map
  }

  return value
}

// #################
// ### Public API
// #################

/**
 * A function that receives a mutable proxy of the document state.
 */
type ChangeFn<T> = (doc: T) => void

/**
 * Creates a new ExtendedLoroDoc from a plain JavaScript object.
 */
export function from<T extends Record<string, unknown>>(
  initialState: T & NoOptional<T>,
): ExtendedLoroDoc<AsLoro<T>> {
  const doc = new ExtendedLoroDoc<AsLoro<T>>()

  // Apply initial state directly to LoroDoc without generating patches
  applyStateToLoroDoc(doc, initialState)

  return doc
}

/**
 * Modifies an ExtendedLoroDoc using mutative for POJO operations and direct CRDT access.
 *
 * This is the core innovation: mutative handles ALL array/object operations naturally,
 * while CRDT containers are injected as proxies that capture operations for TEA integration.
 */
export function change<T>(
  doc: ExtendedLoroDoc<T>,
  callback: ChangeFn<T>,
): ExtendedLoroDoc<T>
export function change<T>(
  doc: ExtendedLoroDoc<T>,
  callback: ChangeFn<T>,
  options: ChangeOptions & { enablePatches: true },
): [ExtendedLoroDoc<T>, CombinedPatch[]]
export function change<T>(
  doc: ExtendedLoroDoc<T>,
  callback: ChangeFn<T>,
  options?: ChangeOptions,
): ExtendedLoroDoc<T> | [ExtendedLoroDoc<T>, CombinedPatch[]] {
  const currentState = doc.toJSON()
  const crdtPatches: CRDTPatch[] = []
  const enablePatches = options?.enablePatches ?? false

  // Inject CRDT proxies into the state for direct access
  const crdtAwareState = injectCRDTProxies(
    currentState,
    doc.getMap("doc"),
    crdtPatches,
  )

  // Let mutative handle ALL POJO operations (arrays, objects, primitives)
  const result = create(crdtAwareState, callback, {
    enablePatches,
  })

  // Handle different return formats from mutative
  const newState = Array.isArray(result) ? result[0] : result
  const mutativePatches =
    Array.isArray(result) && enablePatches ? result[1] : []

  // Apply the new state back to LoroDoc
  applyStateToLoroDoc(doc, newState)

  doc.commit()

  // Return patches if requested (following mutative's pattern)
  if (enablePatches) {
    const allPatches: CombinedPatch[] = [
      ...(mutativePatches || []),
      ...crdtPatches,
    ]
    return [doc, allPatches]
  }

  return doc
}
