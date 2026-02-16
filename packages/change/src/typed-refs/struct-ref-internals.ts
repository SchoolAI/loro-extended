import type { Container, LoroDoc, LoroMap } from "loro-crdt"
import type { ExtMapRef } from "../ext.js"
import type { PlainValueRef } from "../plain-value-ref/index.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
  ValueShape,
} from "../shape.js"
import { isValueShape } from "../utils/type-guards.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRef,
  type TypedRefParams,
} from "./base.js"
import {
  createPlainValueRefForProperty,
  resolveValueForBatchedMutation,
  unwrapPlainValueRef,
} from "./plain-value-access.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
} from "./utils.js"

/**
 * Internal implementation for StructRef.
 * Contains all logic, state, and implementation details.
 */
export class StructRefInternals<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends BaseRefInternals<any> {
  // Cache only container refs - value shapes now return PlainValueRef (no caching needed)
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()

  /** Get typed ref params for creating child refs at a key */
  getChildTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    const placeholder = (this.getPlaceholder() as any)?.[key]

    // AnyContainerShape is an escape hatch - it doesn't have a constructor
    if (!hasContainerConstructor(shape._type)) {
      throw new Error(
        `Cannot create typed ref for shape type "${shape._type}". ` +
          `Use Shape.any() only at the document root level.`,
      )
    }

    // For mergeable documents, use flattened root containers
    if (this.isMergeable()) {
      const doc = this.getDoc()
      const rootName = this.computeChildRootContainerName(key)
      const pathPrefix = this.getPathPrefix() || []
      const newPathPrefix = [...pathPrefix, key]

      // Set null marker in parent map to indicate child container reference
      const container = this.getContainer() as LoroMap
      if (container.get(key) !== null) {
        container.set(key, null)
      }

      // Use the appropriate root container getter based on shape type
      const containerGetter = {
        counter: "getCounter",
        list: "getList",
        movableList: "getMovableList",
        record: "getMap",
        struct: "getMap",
        text: "getText",
        tree: "getTree",
      } as const

      const getterName =
        containerGetter[shape._type as keyof typeof containerGetter]
      const getter = (doc as any)[getterName].bind(doc)

      return {
        shape,
        placeholder,
        getContainer: () => getter(rootName),
        autoCommit: this.getAutoCommit(),
        batchedMutation: this.getBatchedMutation(),
        getDoc: () => doc,
        overlay: this.getOverlay(),
        pathPrefix: newPathPrefix,
        mergeable: true,
      }
    }

    // Non-mergeable: use standard nested container storage
    const LoroContainer = containerConstructor[shape._type]
    const container = this.getContainer() as LoroMap

    return {
      shape,
      placeholder,
      getContainer: () =>
        container.getOrCreateContainer(key, new (LoroContainer as any)()),
      autoCommit: this.getAutoCommit(),
      batchedMutation: this.getBatchedMutation(),
      getDoc: () => this.getDoc(),
      overlay: this.getOverlay(),
    }
  }

  /** Get or create a ref for a key */
  getOrCreateRef<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape?: Shape,
  ): unknown {
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    const actualShape = shape || structShape.shapes[key]

    if (isValueShape(actualShape)) {
      if (this.getBatchedMutation()) {
        // Inside change() — use runtime typeof check to decide:
        // - Primitive values (string, number, boolean, null): return raw value
        //   for ergonomic boolean logic (`if (draft.active)`, `!draft.published`)
        // - Object/array values: return PlainValueRef for nested mutation tracking
        //   (`item.metadata.author = "Alice"`)
        //
        // This replaces the old schema-based valueType heuristic which was
        // semantically wrong for union and any shapes that can contain either
        // primitives or objects at runtime.
        return resolveValueForBatchedMutation(this, key, actualShape)
      }
      // Outside change() — return PlainValueRef for reactive subscriptions
      return createPlainValueRefForProperty(
        this,
        key,
        actualShape as ValueShape,
      )
    }

    // Container shapes: safe to cache (handles)
    let ref = this.propertyCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(
        this.getChildTypedRefParams(key, actualShape as ContainerShape),
      )
      this.propertyCache.set(key, ref)
    }

    return ref as Shape extends ContainerShape
      ? TypedRef<Shape>
      : PlainValueRef<any>
  }

  /** Set a property value */
  setPropertyValue(key: string, value: unknown): void {
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    const shape = structShape.shapes[key]
    const container = this.getContainer() as LoroMap

    if (!shape) {
      throw new Error(`Unknown property: ${key}`)
    }

    if (isValueShape(shape)) {
      // Unwrap PlainValueRef if the value is one (supports ref = otherRef assignment)
      const unwrapped = unwrapPlainValueRef(value)
      container.set(key, unwrapped)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      // assignPlainValueToTypedRef handles batching and commits internally
      const ref = this.getOrCreateRef(key, shape)
      if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
        // Don't call commitIfAuto here - assignPlainValueToTypedRef handles it
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  /** Delete a property */
  deleteProperty(key: string): void {
    const container = this.getContainer() as LoroMap
    container.delete(key)
    this.propertyCache.delete(key)
    this.commitIfAuto()
  }

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    // Value shapes now use PlainValueRef with eager write-back, so we only need
    // to recurse into container children (which may have their own cached values)
    absorbCachedPlainValues(
      this.propertyCache,
      () => this.getContainer() as LoroMap,
    )
  }

  /** Force materialization of the container and its nested containers */
  override materialize(): void {
    // Ensure this container exists
    this.getContainer()

    // Recursively materialize nested containers
    const structShape = this.getShape() as StructContainerShape<NestedShapes>
    for (const key in structShape.shapes) {
      const shape = structShape.shapes[key]
      if (!isValueShape(shape)) {
        // Get the ref (which creates it if needed)
        const ref = this.getOrCreateRef(key, shape) as TypedRef<any>
        // Force materialization
        ref[INTERNAL_SYMBOL].materialize()
      }
    }
  }

  /** Create the ext namespace for struct */
  protected override createExtNamespace(): ExtMapRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      setContainer(key: string, container: Container): Container {
        const result = (self.getContainer() as LoroMap).setContainer(
          key,
          container,
        )
        self.commitIfAuto()
        return result
      },
    }
  }
}
