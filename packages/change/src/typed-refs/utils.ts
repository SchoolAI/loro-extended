import {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  type Value,
} from "loro-crdt"
import type {
  ContainerShape,
  CounterContainerShape,
  ListContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  StructContainerShape,
  TextContainerShape,
  TreeContainerShape,
} from "../shape.js"
import { INTERNAL_SYMBOL, type TypedRef, type TypedRefParams } from "./base.js"
import { CounterRef } from "./counter-ref.js"
import { ListRef } from "./list-ref.js"
import { MovableListRef } from "./movable-list-ref.js"
import {
  listProxyHandler,
  movableListProxyHandler,
  recordProxyHandler,
} from "./proxy-handlers.js"
import { RecordRef } from "./record-ref.js"
import { createStructRef } from "./struct-ref.js"
import { TextRef } from "./text-ref.js"
import { TreeRef } from "./tree-ref.js"

/**
 * Mapping from container shape types to their Loro constructor classes.
 * Used when creating new containers via getOrCreateContainer().
 *
 * Note: "any" is not included because AnyContainerShape is an escape hatch
 * that doesn't create typed refs - it returns raw Loro containers.
 */
export const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  movableList: LoroMovableList,
  record: LoroMap, // Records use LoroMap as their underlying container
  struct: LoroMap, // Structs use LoroMap as their underlying container
  text: LoroText,
  tree: LoroTree,
} as const

/**
 * Type guard to check if a container shape type has a constructor.
 * Returns false for "any" which is an escape hatch.
 */
export function hasContainerConstructor(
  type: string,
): type is keyof typeof containerConstructor {
  return type in containerConstructor
}

/**
 * Unwraps a TypedRef to its primitive value for readonly access.
 * Counter refs return their numeric value, Text refs return their string.
 * Other container types are returned as-is.
 */
export function unwrapReadonlyPrimitive(
  ref: TypedRef<any>,
  shape: ContainerShape,
): any {
  if (shape._type === "counter") {
    return (ref as any).value
  }
  if (shape._type === "text") {
    return (ref as any).toString()
  }
  return ref
}

/**
 * Type guard to check if a value has internal methods via INTERNAL_SYMBOL.
 */
function hasInternalSymbol(
  value: unknown,
): value is { [INTERNAL_SYMBOL]: { absorbPlainValues(): void } } {
  return value !== null && typeof value === "object" && INTERNAL_SYMBOL in value
}

/**
 * Absorbs cached plain values back into a LoroMap container.
 * For TypedRef entries (or any object with INTERNAL_SYMBOL), recursively calls absorbPlainValues().
 * For plain Value entries, sets them directly on the container.
 */
export function absorbCachedPlainValues(
  cache: Map<string, TypedRef<ContainerShape> | Value>,
  getContainer: () => LoroMap,
): void {
  let container: LoroMap | undefined

  for (const [key, ref] of cache.entries()) {
    if (hasInternalSymbol(ref)) {
      // Contains a TypedRef or TreeRef, not a plain Value: keep recursing
      ref[INTERNAL_SYMBOL].absorbPlainValues()
    } else {
      // Plain value!
      if (!container) container = getContainer()
      container.set(key, ref)
    }
  }
}

/**
 * Serializes a TypedRef to JSON by iterating over its keys.
 * For nested TypedRefs with toJSON(), calls their toJSON method.
 * For plain values, includes them directly.
 */
export function serializeRefToJSON(
  ref: Record<string, any>,
  keys: Iterable<string>,
): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key of keys) {
    const value = ref[key]
    if (value && typeof value === "object" && "toJSON" in value) {
      result[key] = value.toJSON()
    } else {
      result[key] = value
    }
  }
  return result
}

// Generic catch-all overload
export function createContainerTypedRef<T extends ContainerShape>(
  params: TypedRefParams<T>,
): TypedRef<T>

// Implementation
export function createContainerTypedRef(
  params: TypedRefParams<ContainerShape>,
): TypedRef<ContainerShape> | TreeRef<StructContainerShape> {
  switch (params.shape._type) {
    case "counter":
      return new CounterRef(params as TypedRefParams<CounterContainerShape>)
    case "list":
      return new Proxy(
        new ListRef(params as TypedRefParams<ListContainerShape>),
        listProxyHandler,
      )
    case "struct":
      return createStructRef(
        params as TypedRefParams<StructContainerShape>,
      ) as unknown as TypedRef<ContainerShape>
    case "movableList":
      return new Proxy(
        new MovableListRef(params as TypedRefParams<MovableListContainerShape>),
        movableListProxyHandler,
      )
    case "record":
      return new Proxy(
        new RecordRef(params as TypedRefParams<RecordContainerShape>),
        recordProxyHandler,
      )
    case "text":
      return new TextRef(params as TypedRefParams<TextContainerShape>)
    case "tree": {
      const treeShape = params.shape as TreeContainerShape
      return new TreeRef({
        shape: treeShape,
        placeholder: params.placeholder as never[],
        getContainer: params.getContainer as () => LoroTree,
        autoCommit: params.autoCommit,
        getDoc: params.getDoc,
      })
    }
    default:
      throw new Error(
        `Unknown container type: ${(params.shape as ContainerShape)._type}`,
      )
  }
}

export function assignPlainValueToTypedRef(
  ref: TypedRef<any>,
  value: any,
): boolean {
  // Access shape via INTERNAL_SYMBOL or fallback to direct property access for StructRef proxy
  const shape = ref[INTERNAL_SYMBOL]?.getShape?.() ?? (ref as any).shape
  const shapeType = shape?._type

  if (shapeType === "struct" || shapeType === "record") {
    for (const k in value) {
      ;(ref as any)[k] = value[k]
    }
    return true
  }

  if (shapeType === "list" || shapeType === "movableList") {
    if (Array.isArray(value)) {
      const listRef = ref as any
      if (listRef.length > 0) {
        listRef.delete(0, listRef.length)
      }
      for (const item of value) {
        listRef.push(item)
      }
      return true
    }
  }

  if (shapeType === "text") {
    if (typeof value === "string") {
      ;(ref as any).update(value)
      return true
    }
    return false
  }

  if (shapeType === "counter") {
    if (typeof value === "number") {
      const currentValue = (ref as any).value
      const diff = value - currentValue
      if (diff > 0) {
        ;(ref as any).increment(diff)
      } else if (diff < 0) {
        ;(ref as any).decrement(-diff)
      }
      return true
    }
    return false
  }

  return false
}
