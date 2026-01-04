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

  constructor(
    params: Omit<TypedRefParams<Shape>, "getContainer" | "getDoc"> & {
      doc: LoroDoc
      autoCommit?: boolean
      batchedMutation?: boolean
    },
  ) {
    super({
      ...params,
      getContainer: () => {
        throw new Error("can't get container on DocRef")
      },
      getDoc: () => params.doc,
    } as TypedRefParams<Shape>)

    this.doc = params.doc
    this.requiredPlaceholder = params.placeholder as Infer<Shape>
  }

  /** Get typed ref params for creating child refs at a key */
  getTypedRefParams(
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

    return {
      shape,
      placeholder: this.requiredPlaceholder[key],
      getContainer: () => getter(key),
      autoCommit: this.getAutoCommit(),
      batchedMutation: this.getBatchedMutation(),
      getDoc: () => this.doc,
    }
  }

  /** Get or create a typed ref for a key */
  getOrCreateTypedRef(
    key: string,
    shape: ContainerShape,
  ): TypedRef<ContainerShape> | number | string {
    let ref = this.propertyCache.get(key)

    if (!ref) {
      ref = createContainerTypedRef(this.getTypedRefParams(key, shape))
      this.propertyCache.set(key, ref)
    }

    return ref
  }

  /** Absorb mutated plain values back into Loro containers */
  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const [, ref] of this.propertyCache.entries()) {
      ref[INTERNAL_SYMBOL].absorbPlainValues()
    }
  }
}
