import type { LoroDoc } from "loro-crdt"
import type { Infer } from "../index.js"
import type { ContainerShape, DocShape } from "../shape.js"
import {
  BaseRefInternals,
  INTERNAL_SYMBOL,
  type TypedRef,
  type TypedRefParams,
} from "./base.js"
import { createContainerTypedRef } from "./utils.js"

const containerGetter = {
  counter: "getCounter",
  list: "getList",
  movableList: "getMovableList",
  record: "getMap",
  struct: "getMap", // Structs use LoroMap as their underlying container
  text: "getText",
  tree: "getTree",
} as const satisfies Record<string, keyof LoroDoc>

type ContainerGetterKey = keyof typeof containerGetter

/**
 * Internal implementation for DocRef.
 * Contains all logic, state, and implementation details.
 */
export class DocRefInternals<
  Shape extends DocShape,
> extends BaseRefInternals<Shape> {
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()
  private doc: LoroDoc
  private requiredPlaceholder: Infer<Shape>
  private _mergeable: boolean

  constructor(
    params: Omit<TypedRefParams<Shape>, "getContainer" | "getDoc"> & {
      doc: LoroDoc
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
    this.requiredPlaceholder = params.placeholder as Infer<Shape>
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

    const getterName = containerGetter[shape._type as ContainerGetterKey]
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
