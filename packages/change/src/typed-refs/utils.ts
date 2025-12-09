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
  MapContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  TextContainerShape,
  TreeContainerShape,
} from "../shape.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import { CounterRef } from "./counter.js"
import { ListRef } from "./list.js"
import { MapRef } from "./map.js"
import { MovableListRef } from "./movable-list.js"
import {
  listProxyHandler,
  movableListProxyHandler,
  recordProxyHandler,
} from "./proxy-handlers.js"
import { RecordRef } from "./record.js"
import { TextRef } from "./text.js"
import { TreeRef } from "./tree.js"

/**
 * Mapping from container shape types to their Loro constructor classes.
 * Used when creating new containers via getOrCreateContainer().
 */
export const containerConstructor = {
  counter: LoroCounter,
  list: LoroList,
  map: LoroMap,
  movableList: LoroMovableList,
  record: LoroMap, // Records use LoroMap as their underlying container
  text: LoroText,
  tree: LoroTree,
} as const

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
 * Absorbs cached plain values back into a LoroMap container.
 * For TypedRef entries, recursively calls absorbPlainValues().
 * For plain Value entries, sets them directly on the container.
 */
export function absorbCachedPlainValues(
  cache: Map<string, TypedRef<ContainerShape> | Value>,
  getContainer: () => LoroMap,
): void {
  let container: LoroMap | undefined

  for (const [key, ref] of cache.entries()) {
    if (ref instanceof TypedRef) {
      // Contains a TypedRef, not a plain Value: keep recursing
      ref.absorbPlainValues()
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
): TypedRef<ContainerShape> {
  switch (params.shape._type) {
    case "counter":
      return new CounterRef(params as TypedRefParams<CounterContainerShape>)
    case "list":
      return new Proxy(
        new ListRef(params as TypedRefParams<ListContainerShape>),
        listProxyHandler,
      )
    case "map":
      return new MapRef(params as TypedRefParams<MapContainerShape>)
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
    case "tree":
      return new TreeRef(params as TypedRefParams<TreeContainerShape>)
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
  const shapeType = (ref as any).shape._type

  if (shapeType === "map" || shapeType === "record") {
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

  return false
}
