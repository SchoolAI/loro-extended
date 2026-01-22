import type {
  Container,
  ContainerID,
  CounterDiff,
  Diff,
  ListDiff,
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  MapDiff,
  TextDiff,
  TreeDiff,
  TreeDiffItem,
  Value,
} from "loro-crdt"

/**
 * Replay a diff as local operations on a document.
 *
 * Unlike doc.import() which creates import events, this creates LOCAL events
 * that are captured by subscribeLocalUpdates() and UndoManager.
 *
 * @param doc - The target document to apply changes to
 * @param diff - The diff from doc.diff(from, to, false)
 */
export function replayDiff(doc: LoroDoc, diff: [ContainerID, Diff][]): void {
  // Map from source container IDs to target containers
  // This is needed because when we create new containers, they get different IDs
  const containerMap = new Map<ContainerID, Container>()

  for (const [containerId, containerDiff] of diff) {
    // First, try to get the container from our map (for newly created containers)
    let container = containerMap.get(containerId)

    // If not in map, try to get it from the doc (for existing containers)
    if (!container) {
      container = doc.getContainerById(containerId)
    }

    if (!container) {
      // Container doesn't exist yet - this can happen for newly created containers
      // that haven't been mapped yet. Skip for now, it will be created when
      // processing the parent container's diff.
      continue
    }

    switch (containerDiff.type) {
      case "text":
        replayTextDiff(container as LoroText, containerDiff)
        break
      case "list":
        replayListDiff(
          container as LoroList | LoroMovableList,
          containerDiff,
          containerMap,
        )
        break
      case "map":
        replayMapDiff(container as LoroMap, containerDiff, containerMap)
        break
      case "tree":
        replayTreeDiff(container as LoroTree, containerDiff)
        break
      case "counter":
        replayCounterDiff(container as LoroCounter, containerDiff)
        break
    }
  }
}

/**
 * Replay text diff operations
 */
function replayTextDiff(text: LoroText, diff: TextDiff): void {
  // LoroText has applyDelta which handles the delta format directly
  text.applyDelta(diff.diff)
}

/**
 * Replay list diff operations
 */
function replayListDiff(
  list: LoroList | LoroMovableList,
  diff: ListDiff,
  containerMap: Map<ContainerID, Container>,
): void {
  let index = 0

  for (const delta of diff.diff) {
    if (delta.retain !== undefined) {
      // Retain: skip over existing elements
      index += delta.retain
    } else if (delta.delete !== undefined) {
      // Delete: remove elements at current position
      list.delete(index, delta.delete)
      // Don't advance index - next operation is at same position
    } else if (delta.insert !== undefined) {
      // Insert: add elements at current position
      const values = delta.insert
      for (let i = 0; i < values.length; i++) {
        const value = values[i]
        if (isContainer(value)) {
          // For containers, we need to insert a new container of the same type
          // The container's contents will be handled by its own diff entry
          const newContainer = createContainerOfSameType(value)
          const insertedContainer = (list as LoroList).insertContainer(
            index + i,
            newContainer,
          )
          // Map the source container ID to the newly created container
          containerMap.set(value.id, insertedContainer)
        } else {
          ;(list as LoroList).insert(
            index + i,
            value as Exclude<Value, Container>,
          )
        }
      }
      index += values.length
    }
  }
}

/**
 * Replay map diff operations
 */
function replayMapDiff(
  map: LoroMap,
  diff: MapDiff,
  containerMap: Map<ContainerID, Container>,
): void {
  for (const [key, value] of Object.entries(diff.updated)) {
    if (value === undefined) {
      // Delete the key
      map.delete(key)
    } else if (isContainer(value)) {
      // Set a container - create a new one of the same type
      const newContainer = createContainerOfSameType(value)
      const insertedContainer = map.setContainer(key, newContainer)
      // Map the source container ID to the newly created container
      containerMap.set(value.id, insertedContainer)
    } else {
      // Set a primitive value
      map.set(key, value as Exclude<Value, Container>)
    }
  }
}

/**
 * Replay tree diff operations
 */
function replayTreeDiff(tree: LoroTree, diff: TreeDiff): void {
  for (const item of diff.diff) {
    replayTreeDiffItem(tree, item)
  }
}

/**
 * Replay a single tree diff item
 */
function replayTreeDiffItem(tree: LoroTree, item: TreeDiffItem): void {
  switch (item.action) {
    case "create":
      // Create a new node under the specified parent
      // Note: The node ID is determined by the CRDT, we can't specify it
      // This means we're creating a NEW node, not recreating the exact same one
      tree.createNode(item.parent, item.index)
      break
    case "delete":
      // Delete the node
      tree.delete(item.target)
      break
    case "move":
      // Move the node to a new parent/position
      tree.move(item.target, item.parent, item.index)
      break
  }
}

/**
 * Replay counter diff operations
 */
function replayCounterDiff(counter: LoroCounter, diff: CounterDiff): void {
  if (diff.increment > 0) {
    counter.increment(diff.increment)
  } else if (diff.increment < 0) {
    counter.decrement(-diff.increment)
  }
  // If increment is 0, no operation needed
}

/**
 * Check if a value is a Container
 */
function isContainer(value: Value | Container): value is Container {
  return (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    typeof (value as Container).kind === "function"
  )
}

/**
 * Create a new detached container of the same type as the given container
 */
function createContainerOfSameType(container: Container): Container {
  const kind = container.kind()
  switch (kind) {
    case "List":
      return new (container.constructor as new () => LoroList)()
    case "Map":
      return new (container.constructor as new () => LoroMap)()
    case "Text":
      return new (container.constructor as new () => LoroText)()
    case "Tree":
      return new (container.constructor as new () => LoroTree)()
    case "Counter":
      return new (container.constructor as new () => LoroCounter)()
    case "MovableList":
      return new (container.constructor as new () => LoroMovableList)()
    default:
      throw new Error(`Unknown container kind: ${kind}`)
  }
}
