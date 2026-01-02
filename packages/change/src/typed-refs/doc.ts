import type { LoroDoc } from "loro-crdt"
import type { Infer } from "../index.js"
import type { ContainerShape, DocShape } from "../shape.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import { createContainerTypedRef, serializeRefToJSON } from "./utils.js"

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

// Doc Ref class -- the actual object passed to the change `mutation` function
export class DocRef<Shape extends DocShape> extends TypedRef<Shape> {
  private _doc: LoroDoc
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()
  private requiredPlaceholder!: Infer<Shape>

  constructor(
    _params: Omit<TypedRefParams<Shape>, "getContainer" | "getDoc"> & {
      doc: LoroDoc
      autoCommit?: boolean
      batchedMutation?: boolean
    },
  ) {
    super({
      ..._params,
      getContainer: () => {
        throw new Error("can't get container on DocRef")
      },
      getDoc: () => this._doc,
    })
    if (!_params.placeholder) throw new Error("placeholder required")
    this._doc = _params.doc
    this.requiredPlaceholder = _params.placeholder
    this.createLazyProperties()
  }

  getTypedRefParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): TypedRefParams<ContainerShape> {
    // Handle "any" shape type - it's an escape hatch that doesn't have a specific getter
    if (shape._type === "any") {
      throw new Error(
        `Cannot get typed ref params for "any" shape type. ` +
          `The "any" shape is an escape hatch for untyped containers and should be accessed directly via loroDoc.`,
      )
    }

    const getterName = containerGetter[shape._type as ContainerGetterKey]
    const getter = this._doc[getterName].bind(this._doc)

    return {
      shape,
      placeholder: this.requiredPlaceholder[key],
      getContainer: () => getter(key),
      autoCommit: this._params.autoCommit,
      batchedMutation: this.batchedMutation,
      getDoc: () => this._doc,
    }
  }

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

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateTypedRef(key, shape),
        enumerable: true,
      })
    }
  }

  toJSON(): Infer<Shape> {
    return serializeRefToJSON(
      this as any,
      Object.keys(this.shape.shapes),
    ) as Infer<Shape>
  }

  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const [, ref] of this.propertyCache.entries()) {
      ref.absorbPlainValues()
    }
  }
}
