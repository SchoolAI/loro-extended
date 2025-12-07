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
import type { TypedRef, TypedRefParams } from "./base.js"
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
  node: TypedRef<any>,
  value: any,
): boolean {
  const shapeType = (node as any).shape._type

  if (shapeType === "map" || shapeType === "record") {
    for (const k in value) {
      ;(node as any)[k] = value[k]
    }
    return true
  }

  if (shapeType === "list" || shapeType === "movableList") {
    if (Array.isArray(value)) {
      const listNode = node as any
      if (listNode.length > 0) {
        listNode.delete(0, listNode.length)
      }
      for (const item of value) {
        listNode.push(item)
      }
      return true
    }
  }

  return false
}
