import { LoroDoc, LoroMap, LoroList, LoroText } from "loro-crdt"

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
 * Creates a new Loro document from a plain JavaScript object.
 *
 * This function recursively converts the initial state into Loro's
 * CRDT containers (LoroMap for objects, LoroList for arrays).
 *
 * @example
 * ```ts
 * import { from, change, toJS } from './loro';
 *
 * const doc = from({
 *   name: 'Alice',
 *   tasks: [{ description: 'Buy milk', done: false }]
 * });
 *
 * const modifiedDoc = change(doc, d => {
 *   d.tasks[0].done = true;
 * });
 *
 * console.log(toJS(modifiedDoc));
 * // { name: 'Alice', tasks: [{ description: 'Buy milk', done: true }] }
 * ```
 *
 * @param initialState The initial state to populate the document with.
 * @returns A new Loro document.
 */
export function from<T extends Record<string, unknown>>(
  initialState: T,
): LoroDoc {
  const doc = new LoroDoc()
  // Use the change function to set the initial state transactionally.
  return change<T>(doc, d => {
    Object.assign(d, initialState)
  })
}

// #################
// ### Change
// #################

/**
 * A function that receives a mutable proxy of the document state.
 */
type ChangeFn<T extends object> = (doc: T) => void

/**
 * Modifies a Loro document within a transactional change block.
 *
 * The provided callback receives a proxy of the document's root.
 * Any mutations made to this proxy are translated into Loro CRDT operations.
 *
 * @param doc The Loro document to modify.
 * @param callback A function that mutates the document proxy.
 * @returns The same Loro document instance.
 */
export function change<T extends object>(
  doc: LoroDoc,
  callback: ChangeFn<T>,
): LoroDoc {
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
function createProxy(container: LoroMap | LoroList | LoroText): object {
  if (container instanceof LoroText) {
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
    if (typeof value === "string") {
        const text = new LoroText();
        text.insert(0, value);
        return text;
    }

    if (Array.isArray(value)) {
        const list = new LoroList();
        for (const item of value) {
            const loroItem = toLoroValue(item);
            if (
                loroItem instanceof LoroMap ||
                loroItem instanceof LoroList ||
                loroItem instanceof LoroText
            ) {
                list.pushContainer(loroItem);
            } else {
                list.push(loroItem);
            }
        }
        return list;
    }

    if (isPlainObject(value)) {
        const map = new LoroMap();
        for (const [key, subValue] of Object.entries(value)) {
            const loroSubValue = toLoroValue(subValue);
            if (
                loroSubValue instanceof LoroMap ||
                loroSubValue instanceof LoroList ||
                loroSubValue instanceof LoroText
            ) {
                map.setContainer(key, loroSubValue);
            } else {
                map.set(key, loroSubValue);
            }
        }
        return map;
    }

    return value;
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
			if (value instanceof LoroText) {
				return value;
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
              item instanceof LoroText
            ) {
              target.insertContainer(start + i, item)
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
            item instanceof LoroText
          ) {
            target.insertContainer(0, item)
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
        const current = target.get(String(prop));
        if (current instanceof LoroText && typeof value === 'string') {
            current.delete(0, current.length);
            current.insert(0, value);
            return true;
        }

        const loroValue = toLoroValue(value);
        if (loroValue instanceof LoroMap || loroValue instanceof LoroList || loroValue instanceof LoroText) {
            target.setContainer(String(prop), loroValue as LoroMap | LoroList | LoroText);
        } else {
            target.set(String(prop), loroValue);
        }
        return true;
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
          loroValue instanceof LoroText
        ) {
          target.insertContainer(index, loroValue)
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
  deleteProperty(target, prop) {
    if (target instanceof LoroMap) {
      // Loro "deletes" a key by setting its value to undefined.
      target.set(String(prop), undefined)
      return true
    }

    if (target instanceof LoroList) {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        target.delete(index, 1)
        return true
      }
    }

    return false
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
      const json = target.toJSON() as Record<string, unknown>
      return Object.keys(json).filter(
        key => json[key] !== null && json[key] !== undefined,
      )
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
