import type {
  ContainerShape,
  CounterContainerShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  TextContainerShape,
  TreeContainerShape,
} from "../shape.js"
import type { DraftNode, DraftNodeParams } from "./base.js"
import { CounterDraftNode } from "./counter.js"
import { ListDraftNode } from "./list.js"
import { MapDraftNode } from "./map.js"
import { MovableListDraftNode } from "./movable-list.js"
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
      return new ListDraftNode(params as DraftNodeParams<ListContainerShape>)
    case "map":
      return new MapDraftNode(params as DraftNodeParams<MapContainerShape>)
    case "movableList":
      return new MovableListDraftNode(
        params as DraftNodeParams<MovableListContainerShape>,
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
