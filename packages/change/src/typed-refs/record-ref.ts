import type { Container, LoroMap } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer, InferMutableType } from "../types.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import { RecordRefInternals } from "./record-ref-internals.js"
import { serializeRefToJSON } from "./utils.js"

/**
 * Record typed ref - thin facade that delegates to RecordRefInternals.
 */
export class RecordRef<
  NestedShape extends ContainerOrValueShape,
> extends TypedRef<any> {
  [key: string]: InferMutableType<NestedShape> | undefined | any

  [INTERNAL_SYMBOL]: RecordRefInternals<NestedShape>

  constructor(params: TypedRefParams<any>) {
    super()
    this[INTERNAL_SYMBOL] = new RecordRefInternals(params)
  }

  /** Set a value at a key */
  set(key: string, value: any): void {
    this[INTERNAL_SYMBOL].set(key, value)
  }

  /** Delete a key */
  delete(key: string): void {
    this[INTERNAL_SYMBOL].delete(key)
  }

  get(key: string): InferMutableType<NestedShape> | undefined {
    // In batched mutation mode (inside change()), use getOrCreateRef to create containers
    // This allows patterns like: draft.scores.get("alice")!.increment(10)
    if (this[INTERNAL_SYMBOL].getBatchedMutation()) {
      return this[INTERNAL_SYMBOL].getOrCreateRef(key) as
        | InferMutableType<NestedShape>
        | undefined
    }
    // In readonly mode, use getRef which returns undefined for non-existent keys
    return this[INTERNAL_SYMBOL].getRef(key) as
      | InferMutableType<NestedShape>
      | undefined
  }

  setContainer<C extends Container>(key: string, container: C): C {
    const loroContainer = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    const result = loroContainer.setContainer(key, container)
    this[INTERNAL_SYMBOL].commitIfAuto()
    return result
  }

  has(key: string): boolean {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.get(key) !== undefined
  }

  keys(): string[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.keys()
  }

  values(): any[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.values()
  }

  get size(): number {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.size
  }

  toJSON(): Record<string, Infer<NestedShape>> {
    return serializeRefToJSON(this, this.keys()) as Record<
      string,
      Infer<NestedShape>
    >
  }
}
