import type { LoroDoc } from "loro-crdt"
import {
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
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

import {
  type BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRef,
  type TypedRefParams,
} from "./base.js"
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
 * Mapping from container shape types to their LoroDoc getter method names.
 * Used when resolving root containers (both hierarchical and flattened/mergeable storage).
 *
 * Note: "any" is not included because AnyContainerShape is an escape hatch
 * that doesn't create typed refs - it returns raw Loro containers.
 */
export const containerGetter = {
  counter: "getCounter",
  list: "getList",
  movableList: "getMovableList",
  record: "getMap",
  struct: "getMap", // Structs use LoroMap as their underlying container
  text: "getText",
  tree: "getTree",
} as const satisfies Record<string, keyof LoroDoc>

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
 * Builds TypedRefParams for a child container of a map-backed ref (struct or record).
 *
 * This is the shared logic for StructRefInternals.getChildTypedRefParams and
 * RecordRefInternals.getChildTypedRefParams. The only varying input is `placeholder`,
 * which callers compute differently:
 * - Structs: `(this.getPlaceholder() as any)?.[key]`
 * - Records: `(this.getPlaceholder() as any)?.[key] ?? deriveShapePlaceholder(shape)`
 *
 * Handles both mergeable (flattened root storage with null markers) and
 * non-mergeable (nested getOrCreateContainer) paths.
 */
export function buildChildTypedRefParams(
  internals: BaseRefInternals<any>,
  key: string,
  shape: ContainerShape,
  placeholder: TypedRefParams<ContainerShape>["placeholder"],
): TypedRefParams<ContainerShape> {
  // AnyContainerShape is an escape hatch - it doesn't have a constructor
  if (!hasContainerConstructor(shape._type)) {
    throw new Error(
      `Cannot create typed ref for shape type "${shape._type}". ` +
        `Use Shape.any() only at the document root level.`,
    )
  }

  // For mergeable documents, use flattened root containers
  if (internals.isMergeable()) {
    const doc = internals.getDoc()
    const rootName = internals.computeChildRootContainerName(key)
    const pathPrefix = internals.getPathPrefix() || []
    const newPathPrefix = [...pathPrefix, key]

    // Set null marker in parent map to indicate child container reference
    const container = internals.getContainer() as LoroMap
    if (container.get(key) !== null) {
      container.set(key, null)
    }

    const getterName =
      containerGetter[shape._type as keyof typeof containerGetter]
    const getter = (doc as any)[getterName].bind(doc)

    return {
      shape,
      placeholder,
      getContainer: () => getter(rootName),
      autoCommit: internals.getAutoCommit(),
      batchedMutation: internals.getBatchedMutation(),
      getDoc: () => doc,
      overlay: internals.getOverlay(),
      pathPrefix: newPathPrefix,
      mergeable: true,
    }
  }

  // Non-mergeable: use standard nested container storage
  const LoroContainer = containerConstructor[shape._type]
  const container = internals.getContainer() as LoroMap

  return {
    shape,
    placeholder,
    getContainer: () =>
      container.getOrCreateContainer(key, new (LoroContainer as any)()),
    autoCommit: internals.getAutoCommit(),
    batchedMutation: internals.getBatchedMutation(),
    getDoc: () => internals.getDoc(),
    overlay: internals.getOverlay(),
  }
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
    return (ref as any).get()
  }
  if (shape._type === "text") {
    return (ref as any).toString()
  }
  return ref
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
        batchedMutation: params.batchedMutation,
        getDoc: params.getDoc,
        overlay: params.overlay,
      })
    }
    default:
      throw new Error(
        `Unknown container type: ${(params.shape as ContainerShape)._type}`,
      )
  }
}

/**
 * Assigns a plain JavaScript value to a TypedRef.
 *
 * For struct/record types, this batches all property assignments and only
 * commits once at the end to avoid multiple subscription notifications.
 *
 * @param ref - The TypedRef to assign to
 * @param value - The plain value to assign
 * @returns true if assignment was successful, false otherwise
 */
export function assignPlainValueToTypedRef(
  ref: TypedRef<any>,
  value: any,
): boolean {
  // Access internals via INTERNAL_SYMBOL
  const internals = ref[INTERNAL_SYMBOL]

  // Force materialization of the container
  if (internals) {
    internals.materialize()
  }

  const shape = internals?.getShape?.() ?? (ref as any).shape
  const shapeType = shape?._type

  if (shapeType === "struct") {
    const structShapes = shape.shapes as Record<string, { _type: string }>

    internals.withBatchedCommit(() => {
      for (const k in value) {
        const propRef = (ref as any)[k]
        const propShape = structShapes?.[k]

        // Handle CounterRef specially - it has increment/decrement, not set
        if (propShape?._type === "counter") {
          if (typeof value[k] === "number") {
            const currentValue = propRef.get()
            const diff = value[k] - currentValue
            if (diff > 0) {
              propRef.increment(diff)
            } else if (diff < 0) {
              propRef.decrement(-diff)
            }
          }
        } else if (
          propShape?._type === "struct" ||
          propShape?._type === "record"
        ) {
          // Nested container refs - recursively assign
          if (propRef && INTERNAL_SYMBOL in propRef) {
            assignPlainValueToTypedRef(propRef, value[k])
          }
        } else if (
          propShape?._type === "list" ||
          propShape?._type === "movableList"
        ) {
          // ListRef - recursively assign to update the list contents
          if (propRef && INTERNAL_SYMBOL in propRef) {
            assignPlainValueToTypedRef(propRef, value[k])
          }
        } else if (propShape?._type === "text") {
          // TextRef uses .update() method
          if (propRef && typeof propRef.update === "function") {
            propRef.update(value[k])
          }
        } else if (propRef && typeof propRef.set === "function") {
          // Use .set() on PlainValueRef or other refs with set method
          propRef.set(value[k])
        }
      }
    })

    return true
  }

  if (shapeType === "record") {
    internals.withBatchedCommit(() => {
      for (const k in value) {
        // Use RecordRef.set(key, value) method
        ;(ref as any).set(k, value[k])
      }
    })

    return true
  }

  if (shapeType === "list" || shapeType === "movableList") {
    if (Array.isArray(value)) {
      const listRef = ref as any

      internals.withBatchedCommit(() => {
        if (listRef.length > 0) {
          listRef.delete(0, listRef.length)
        }
        for (const item of value) {
          listRef.push(item)
        }
      })

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
      const currentValue = (ref as any).get()
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
