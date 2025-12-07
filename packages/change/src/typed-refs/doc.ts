import type { LoroDoc } from "loro-crdt"
import type { Infer } from "../index.js"
import type { ContainerShape, DocShape } from "../shape.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import { createContainerTypedRef } from "./utils.js"

const containerGetter = {
  counter: "getCounter",
  list: "getList",
  map: "getMap",
  movableList: "getMovableList",
  record: "getMap",
  text: "getText",
  tree: "getTree",
} as const

// Doc Ref class -- the actual object passed to the change `mutation` function
export class DocRef<Shape extends DocShape> extends TypedRef<Shape> {
  private doc: LoroDoc
  private propertyCache = new Map<string, TypedRef<ContainerShape>>()
  private requiredPlaceholder!: Infer<Shape>

  constructor(
    _params: Omit<TypedRefParams<Shape>, "getContainer"> & { doc: LoroDoc },
  ) {
    super({
      ..._params,
      getContainer: () => {
        throw new Error("can't get container on DocRef")
      },
    })
    if (!_params.placeholder) throw new Error("placeholder required")
    this.doc = _params.doc
    this.requiredPlaceholder = _params.placeholder
    this.createLazyProperties()
  }

  getTypedRefParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): TypedRefParams<ContainerShape> {
    const getter = this.doc[containerGetter[shape._type]].bind(this.doc)

    return {
      shape,
      placeholder: this.requiredPlaceholder[key],
      getContainer: () => getter(key),
      readonly: this.readonly,
    }
  }

  getOrCreateTypedRef(
    key: string,
    shape: ContainerShape,
  ): TypedRef<ContainerShape> | number | string {
    if (
      this.readonly &&
      (shape._type === "counter" || shape._type === "text")
    ) {
      // Check if the container exists in the doc without creating it
      const shallow = this.doc.getShallowValue()
      if (!shallow[key]) {
        return this.requiredPlaceholder[key] as any
      }
    }

    let node = this.propertyCache.get(key)

    if (!node) {
      node = createContainerTypedRef(this.getTypedRefParams(key, shape))
      this.propertyCache.set(key, node)
    }

    if (this.readonly) {
      if (shape._type === "counter") {
        return (node as any).value
      }
      if (shape._type === "text") {
        return (node as any).toString()
      }
    }

    return node
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateTypedRef(key, shape),
      })
    }
  }

  absorbPlainValues(): void {
    // By iterating over the propertyCache, we achieve a small optimization
    // by only absorbing values that have been 'touched' in some way
    for (const [, node] of this.propertyCache.entries()) {
      node.absorbPlainValues()
    }
  }
}
