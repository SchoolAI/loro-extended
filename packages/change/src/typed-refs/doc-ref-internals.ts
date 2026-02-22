import type { LoroDoc } from "loro-crdt"
import type { ContainerShape, DocShape } from "../shape.js"
import type { InferPlaceholderType } from "../types.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRef,
  type TypedRefParams,
} from "./base.js"
import { containerGetter, createContainerTypedRef } from "./utils.js"

/**
 * Internal implementation for DocRef.
 * Contains all logic, state, and implementation details.
 */
export class DocRefInternals<
  Shape extends DocShape,
> extends BaseRefInternals<Shape> {
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()
  private doc: LoroDoc
  private requiredPlaceholder: InferPlaceholderType<Shape>
  private _mergeable: boolean

  constructor(
    params: Omit<
      TypedRefParams<Shape>,
      "getContainer" | "getDoc" | "placeholder"
    > & {
      doc: LoroDoc
      placeholder: InferPlaceholderType<Shape>
      autoCommit?: boolean
      batchedMutation?: boolean
      mergeable?: boolean
    },
  ) {
    super({
      ...params,
      getContainer: () => {
        throw new Error("can't get container on DocRef")
      },
      getDoc: () => params.doc,
      mergeable: params.mergeable,
    } as TypedRefParams<Shape>)

    this.doc = params.doc
    this.requiredPlaceholder = params.placeholder
    this._mergeable = !!params.mergeable
  }

  /** Get typed ref params for creating child refs at a key */
  getChildTypedRefParams(
    key: string,
    shape: ContainerShape,
  ): TypedRefParams<ContainerShape> {
    // Handle "any" shape type - it's an escape hatch that doesn't have a specific getter
    if (shape._type === "any") {
      throw new Error(
        `Cannot get typed ref params for "any" shape type. ` +
          `The "any" shape is an escape hatch for untyped containers and should be accessed directly via loroDoc.`,
      )
    }

    const getterName =
      containerGetter[shape._type as keyof typeof containerGetter]
    const getter = this.doc[getterName].bind(this.doc)

    // For mergeable documents, use root containers with path-based names
    // This ensures deterministic container IDs that survive applyDiff
    if (this._mergeable) {
      return {
        shape,
        placeholder: this.requiredPlaceholder[key],
        getContainer: () => getter(key), // Root container with key as name
        autoCommit: this.getAutoCommit(),
        batchedMutation: this.getBatchedMutation(),
        getDoc: () => this.doc,
        overlay: this.getOverlay(),
        pathPrefix: [key], // Start the path prefix for nested containers
        mergeable: true,
      }
    }

    // Non-mergeable: use standard hierarchical storage
    return {
      shape,
      placeholder: this.requiredPlaceholder[key],
      getContainer: () => getter(key),
      autoCommit: this.getAutoCommit(),
      batchedMutation: this.getBatchedMutation(),
      getDoc: () => this.doc,
      overlay: this.getOverlay(),
    }
  }

  /** Get or create a typed ref for a key */
  getOrCreateTypedRef(
    key: string,
    shape: ContainerShape,
  ): TypedRef<ContainerShape> | number | string {
    let ref = this.propertyCache.get(key)

    if (!ref) {
      ref = createContainerTypedRef(this.getChildTypedRefParams(key, shape))
      this.propertyCache.set(key, ref)
    }

    return ref
  }

  /** Recursively finalize nested container refs */
  override finalizeTransaction(): void {
    for (const ref of this.propertyCache.values()) {
      ref[INTERNAL_SYMBOL].finalizeTransaction?.()
    }
  }
}
