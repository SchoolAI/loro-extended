import {
  type Container,
  type ExportMode,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroText,
} from "loro-crdt"

// #################
// ### ExtendedLoroDoc
// #################

/**
 * ExtendedLoroDoc wraps a LoroDoc to provide a cleaner API that hides the internal "root" map.
 * It provides convenient methods for casual users while exposing the underlying LoroDoc for advanced use cases.
 */
export class ExtendedLoroDoc<T = any> {
  private _doc: LoroDoc
  private _rootMap: LoroMap
  private _dataProxy?: T

  constructor(doc?: LoroDoc) {
    this._doc = doc || new LoroDoc()
    this._rootMap = this._doc.getMap("root")
  }

  /**
   * Returns the data as clean JSON without the "root" wrapper.
   */
  toJSON(): T {
    const json = this._doc.toJSON()
    return (json.root as T) || ({} as T)
  }

  /**
   * Provides direct access to the underlying LoroDoc for advanced operations.
   */
  get doc(): LoroDoc {
    return this._doc
  }

  /**
   * Provides proxied access to the data for reading and writing.
   * The proxy is cached for performance.
   */
  get data(): T {
    if (!this._dataProxy) {
      this._dataProxy = createProxy(this._rootMap) as T
    }
    return this._dataProxy
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
    // Clear the cached proxy since the data has changed
    this._dataProxy = undefined
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
   * biome-ignore lint/suspicious/useAdjacentOverloadSignatures: not an import
   */
  static import<T>(data: Uint8Array): ExtendedLoroDoc<T> {
    const doc = new LoroDoc()
    doc.import(data)
    return new ExtendedLoroDoc<T>(doc)
  }

  /**
   * Wraps an existing LoroDoc in an ExtendedLoroDoc.
   * Useful for interoperability with code that provides a LoroDoc.
   */
  static wrap<T>(doc: LoroDoc): ExtendedLoroDoc<T> {
    return new ExtendedLoroDoc<T>(doc)
  }

  /**
   * Unwraps an ExtendedLoroDoc to get the underlying LoroDoc.
   * Useful for interoperability with code that expects a LoroDoc.
   */
  static unwrap<T>(extendedDoc: ExtendedLoroDoc<T>): LoroDoc {
    return extendedDoc.doc
  }
}

// #################
// ### Loro Object
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

// Removed LoroProxyDoc - replaced by ExtendedLoroDoc

/**
 * @hidden
 * A utility type to extract the optional keys from a type T.
 */
type OptionalKeys<T> = {
  // For each key K in T, make it non-optional (-?).
  // Then check if an empty object `{}` can be assigned to `Pick<T, K>`.
  // If `K` is optional (e.g., `_key?: string`), `Pick<T, K>` will be `{ _key?: string }`,
  // and `{}` is assignable to it. In this case, we keep the key `K`.
  // If `K` is required (e.g., `_key: string`), `Pick<T, K>` will be `{ _key: string }`,
  // and `{}` is NOT assignable to it. In this case, we map it to `never`.
  // Finally, `[keyof T]` retrieves all keys that were not mapped to `never`.
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never
}[keyof T]

/**
 * @hidden
 * A utility type that enforces a type `T` to have no optional properties.
 *
 * It works by checking if the `OptionalKeys<T>` type resolves to `never`.
 * If it does, it means `T` has no optional properties, and the original type `T` is returned.
 * If `OptionalKeys<T>` resolves to a union of keys (the optional ones), it triggers a
 * type mismatch by returning a specific error string, which is incompatible with the
 * `initialState` object type in the `from` function, thus generating a compile-time error.
 * The `[... extends ...]` syntax is a robust way to check if a type is `never`.
 */
type NoOptional<T> = [OptionalKeys<T>] extends [never]
  ? T
  : "Error: Optional properties are not supported. Use 'T | null' instead."

/**
 * @hidden
 * Cache to store proxies, mapping a Loro container to its proxy.
 * This prevents re-creating proxies for the same container, improving performance
 * and maintaining object identity.
 */
const proxyCache = new WeakMap<LoroMap | LoroList, object>()

// #################
// ### From
// #################

/**
 * Creates a new ExtendedLoroDoc from a plain JavaScript object.
 *
 * This function recursively converts the initial state into Loro's
 * CRDT containers (LoroMap for objects, LoroList for arrays).
 *
 * @example
 * ```ts
 * import { from, change } from './loro';
 *
 * const doc = from({
 *   name: 'Alice',
 *   tasks: [{ description: 'Buy milk', done: false }]
 * });
 *
 * change(doc, d => {
 *   d.tasks[0].done = true;
 * });
 *
 * console.log(doc.toJSON());
 * // { name: 'Alice', tasks: [{ description: 'Buy milk', done: true }] }
 * ```
 *
 * @param initialState The initial state to populate the document with.
 * @returns A new ExtendedLoroDoc.
 */
export function from<T extends Record<string, unknown>>(
  initialState: T & NoOptional<T>,
): ExtendedLoroDoc<AsLoro<T>> {
  const doc = new ExtendedLoroDoc<AsLoro<T>>()
  // Use the change function to set the initial state transactionally.
  change(doc, d => {
    if (!d || typeof d !== "object") {
      throw new Error("doc under change must be an object")
    }

    Object.assign(d, initialState)
  })
  return doc
}

// #################
// ### Change
// #################

/**
 * A function that receives a mutable proxy of the document state.
 */
type ChangeFn<T> = (doc: T) => void

/**
 * Modifies an ExtendedLoroDoc within a transactional change block.
 *
 * The provided callback receives a proxy of the document's root.
 * Any mutations made to this proxy are translated into Loro CRDT operations.
 *
 * @param doc The ExtendedLoroDoc to modify.
 * @param callback A function that mutates the document proxy.
 * @returns The same ExtendedLoroDoc instance.
 */
export function change<T>(
  doc: ExtendedLoroDoc<T>,
  callback: ChangeFn<T>,
): ExtendedLoroDoc<T> {
  // The root container is always a map.
  const rootContainer = doc.getMap("root")
  const proxy = createProxy(rootContainer)
  callback(proxy as T)
  doc.commit()
  return doc
}

/**
 * @hidden
 * Creates a proxy for a Loro container if one doesn't already exist in the cache.
 * Text containers are returned directly as they don't support proxying.
 */
function createProxy(container: Container): object {
  if (container instanceof LoroText) {
    return container
  }

  if (!(container instanceof LoroMap || container instanceof LoroList)) {
    // Only Map and List containers can be proxied.
    // Return other container types directly.
    return container
  }

  if (proxyCache.has(container)) {
    // biome-ignore lint/style/noNonNullAssertion: guaranteed to exist
    return proxyCache.get(container)!
  }

  const proxy = new Proxy(container, proxyHandlers)
  proxyCache.set(container, proxy)
  return proxy
}

/**
 * @hidden
 * A utility function to check if a value is a plain JavaScript object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.prototype.toString.call(value) !== "[object Object]"
  ) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  if (proto === null) {
    return true
  }
  let baseProto = proto
  while (Object.getPrototypeOf(baseProto) !== null) {
    baseProto = Object.getPrototypeOf(baseProto)
  }
  return proto === baseProto
}

/**
 * @hidden
 * Converts a JavaScript value to a Loro-compatible value.
 * Plain objects and arrays are converted to detached LoroMaps and LoroLists.
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
    // Strings are treated as LWW primitives by default
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

  if (isPlainObject(value)) {
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

/**
 * @hidden
 * The core Proxy handler that intercepts gets, sets, and other operations
 * on the document proxy and translates them into Loro CRDT operations.
 */
const proxyHandlers: ProxyHandler<LoroMap | LoroList> = {
  get(target, prop, receiver) {
    if (target instanceof LoroMap) {
      const value = target.get(String(prop))
      if (value instanceof LoroText || value instanceof LoroCounter) {
        return value
      }
      if (value instanceof LoroMap || value instanceof LoroList) {
        return createProxy(value)
      }
      // Bind methods like 'set', 'get', 'delete' to the target
      if (typeof value === "function") {
        return value.bind(target)
      }
      if (value !== undefined) {
        return value
      }
    }

    if (target instanceof LoroList) {
      if (prop === "length") {
        return target.length
      }

      if (prop === "push") {
        return (...items: unknown[]) => {
          for (const item of items) {
            const loroValue = toLoroValue(item)
            if (
              loroValue instanceof LoroMap ||
              loroValue instanceof LoroList ||
              loroValue instanceof LoroText ||
              loroValue instanceof LoroCounter
            ) {
              target.pushContainer(loroValue as Container)
            } else {
              target.push(loroValue)
            }
          }
          return target.length
        }
      }

      if (prop === "pop") {
        return () => {
          if (target.length === 0) {
            return undefined
          }
          const index = target.length - 1
          const value = target.get(index)
          target.delete(index, 1)
          if (value instanceof LoroMap || value instanceof LoroList) {
            return createProxy(value)
          }
          return value
        }
      }

      if (prop === "splice") {
        return (...args: [number, number, ...unknown[]]) => {
          const [start, deleteCount, ...items] = args
          if (deleteCount > 0) {
            target.delete(start, deleteCount)
          }
          for (let i = 0; i < items.length; i++) {
            const item = toLoroValue(items[i])
            if (
              item instanceof LoroMap ||
              item instanceof LoroList ||
              item instanceof LoroText ||
              item instanceof LoroCounter
            ) {
              target.insertContainer(start + i, item as Container)
            } else {
              target.insert(start + i, item)
            }
          }
        }
      }

      if (prop === "shift") {
        return () => {
          if (target.length === 0) {
            return undefined
          }
          const value = target.get(0)
          target.delete(0, 1)
          return value
        }
      }

      if (prop === "unshift") {
        return (value: unknown) => {
          const item = toLoroValue(value)
          if (
            item instanceof LoroMap ||
            item instanceof LoroList ||
            item instanceof LoroText ||
            item instanceof LoroCounter
          ) {
            target.insertContainer(0, item as Container)
          } else {
            target.insert(0, item)
          }
          return target.length
        }
      }

      const index = Number(prop)
      if (!Number.isNaN(index)) {
        const value = target.get(index)
        if (value instanceof LoroMap || value instanceof LoroList) {
          return createProxy(value)
        }
        return value
      }
    }

    // Fallback for list built-in methods (like .map, .filter) and other symbols
    return Reflect.get(target, prop, receiver)
  },
  set(target, prop, value: unknown) {
    if (target instanceof LoroMap) {
      const current = target.get(String(prop))
      if (current instanceof LoroText && typeof value === "string") {
        current.delete(0, current.length)
        current.insert(0, value)
        return true
      }

      const loroValue = toLoroValue(value)
      if (
        loroValue instanceof LoroMap ||
        loroValue instanceof LoroList ||
        loroValue instanceof LoroText ||
        loroValue instanceof LoroCounter
      ) {
        target.setContainer(String(prop), loroValue as Container)
      } else {
        target.set(String(prop), loroValue)
      }
      return true
    }

    if (target instanceof LoroList) {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        if (index < target.length) {
          target.delete(index, 1)
        }
        const loroValue = toLoroValue(value)
        if (
          loroValue instanceof LoroMap ||
          loroValue instanceof LoroList ||
          loroValue instanceof LoroText ||
          loroValue instanceof LoroCounter
        ) {
          target.insertContainer(index, loroValue as Container)
        } else {
          target.insert(index, loroValue)
        }
        return true
      }
      if (prop === "length") {
        const newLength = Number(value)
        const oldLength = target.length
        if (newLength < oldLength) {
          target.delete(newLength, oldLength - newLength)
        }
        return true
      }
    }

    return false
  },
  deleteProperty(_target, prop) {
    throw new Error(
      `The 'delete' operator is not supported. To remove property "${String(
        prop,
      )}", assign its value to null.`,
    )
  },
  has(target, prop) {
    if (target instanceof LoroMap) {
      return target.get(String(prop)) !== undefined
    }

    if (target instanceof LoroList) {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        return index >= 0 && index < target.length
      }
      // Allow checking for standard array properties
      return (
        prop === "length" ||
        typeof prop === "symbol" ||
        // biome-ignore lint/suspicious/noExplicitAny: runtime check
        typeof (target as any)[prop] !== "undefined"
      )
    }

    return Reflect.has(target, prop)
  },
  ownKeys(target) {
    if (target instanceof LoroMap) {
      // Loro's `keys()` method correctly returns only non-deleted keys.
      return target.keys()
    }

    if (target instanceof LoroList) {
      const keys: string[] = []
      for (let i = 0; i < target.length; i++) {
        keys.push(i.toString())
      }
      keys.push("length")
      return keys
    }

    return Reflect.ownKeys(target)
  },
}
