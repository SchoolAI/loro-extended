import type { LoroDoc } from "loro-crdt"
import type { Infer } from "../index.js"
import { getStorageKey } from "../migration.js"
import { migrateAndGetContainer } from "../migration-executor.js"
import type { ContainerShape, DocShape } from "../shape.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import {
  createContainerTypedRef,
  serializeRefToJSON,
  unwrapReadonlyPrimitive,
} from "./utils.js"

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
    // Use storage key for CRDT access, logical key for placeholder
    const storageKey = getStorageKey(shape, key)

    return {
      shape,
      placeholder: this.requiredPlaceholder[key],
      getContainer: () =>
        migrateAndGetContainer(
          this.doc,
          key,
          shape,
          () => getter(storageKey),
          this.readonly,
        ),
      readonly: this.readonly,
    }
  }

  getOrCreateTypedRef(
    key: string,
    shape: ContainerShape,
  ): TypedRef<ContainerShape> | number | string {
    // Use storage key for CRDT access
    const storageKey = getStorageKey(shape, key)

    if (
      this.readonly &&
      (shape._type === "counter" || shape._type === "text")
    ) {
      // Check if the container exists in the doc without creating it
      const shallow = this.doc.getShallowValue()
      if (!shallow[storageKey]) {
        return this.requiredPlaceholder[key] as any
      }
    }

    let ref = this.propertyCache.get(key)

    if (!ref) {
      ref = createContainerTypedRef(this.getTypedRefParams(key, shape))
      this.propertyCache.set(key, ref)
    }

    if (this.readonly) {
      return unwrapReadonlyPrimitive(ref, shape)
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
