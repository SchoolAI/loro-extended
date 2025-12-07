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
import type { DraftNode, DraftNodeParams } from "./base.js"
import { CounterDraftNode } from "./counter.js"
import { ListDraftNode } from "./list.js"
import { MapDraftNode } from "./map.js"
import { MovableListDraftNode } from "./movable-list.js"
import {
  listProxyHandler,
  movableListProxyHandler,
  recordProxyHandler,
} from "./proxy-handlers.js"
import { RecordDraftNode } from "./record.js"
import { TextDraftNode } from "./text.js"
import { TreeDraftNode } from "./tree.js"

// Generic catch-all overload
export function createContainerDraftNode<T extends ContainerShape>(
  params: DraftNodeParams<T>,
): DraftNode<T>

// Implementation
export function createContainerDraftNode(
  params: DraftNodeParams<ContainerShape>,
): DraftNode<ContainerShape> {
  switch (params.shape._type) {
    case "counter":
      return new CounterDraftNode(
        params as DraftNodeParams<CounterContainerShape>,
      )
    case "list":
      return new Proxy(
        new ListDraftNode(params as DraftNodeParams<ListContainerShape>),
        listProxyHandler,
      )
    case "map":
      return new MapDraftNode(params as DraftNodeParams<MapContainerShape>)
    case "movableList":
      return new Proxy(
        new MovableListDraftNode(
          params as DraftNodeParams<MovableListContainerShape>,
        ),
        movableListProxyHandler,
      )
    case "record":
      return new Proxy(
        new RecordDraftNode(params as DraftNodeParams<RecordContainerShape>),
        recordProxyHandler,
      )
    case "text":
      return new TextDraftNode(params as DraftNodeParams<TextContainerShape>)
    case "tree":
      return new TreeDraftNode(params as DraftNodeParams<TreeContainerShape>)
    default:
      throw new Error(
        `Unknown container type: ${(params.shape as ContainerShape)._type}`,
      )
  }
}

export function assignPlainValueToDraftNode(
  node: DraftNode<any>,
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
