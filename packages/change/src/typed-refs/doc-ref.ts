import type { LoroDoc } from "loro-crdt"
import type { Infer } from "../index.js"
import type { DocShape } from "../shape.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import { DocRefInternals } from "./doc-ref-internals.js"
import { serializeRefToJSON } from "./utils.js"

/**
 * Doc Ref class - thin facade that delegates to DocRefInternals.
 * The actual object passed to the change `mutation` function.
 */
export class DocRef<Shape extends DocShape> extends TypedRef<Shape> {
  [INTERNAL_SYMBOL]: DocRefInternals<Shape>

  constructor(
    params: Omit<TypedRefParams<Shape>, "getContainer" | "getDoc"> & {
      doc: LoroDoc
      autoCommit?: boolean
      batchedMutation?: boolean
    },
  ) {
    super()
    if (!params.placeholder) throw new Error("placeholder required")
    this[INTERNAL_SYMBOL] = new DocRefInternals(params)
    this.createLazyProperties()
  }

  private createLazyProperties(): void {
    const shape = this[INTERNAL_SYMBOL].getShape() as DocShape
    for (const key in shape.shapes) {
      const containerShape = shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () =>
          this[INTERNAL_SYMBOL].getOrCreateTypedRef(key, containerShape),
        enumerable: true,
      })
    }
  }

  toJSON(): Infer<Shape> {
    const shape = this[INTERNAL_SYMBOL].getShape() as DocShape
    return serializeRefToJSON(
      this as any,
      Object.keys(shape.shapes),
    ) as Infer<Shape>
  }
}
