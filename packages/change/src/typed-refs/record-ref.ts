import type { Container, LoroMap } from "loro-crdt"
import type { ContainerOrValueShape } from "../shape.js"
import type { Infer, InferMutableType } from "../types.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import { RecordRefInternals } from "./record-ref-internals.js"
import { serializeRefToJSON } from "./utils.js"

/**
 * Record typed ref - thin facade that delegates to RecordRefInternals.
 *
 * Note: This class does NOT have an index signature to avoid conflicts with methods.
 * Use `IndexedRecordRef<NestedShape>` for the user-facing type that supports bracket access.
 * The Proxy wrapper handles runtime bracket access via `recordProxyHandler`.
 */
export class RecordRef<
  NestedShape extends ContainerOrValueShape,
> extends TypedRef<any> {
  [INTERNAL_SYMBOL]: RecordRefInternals<NestedShape>

  constructor(params: TypedRefParams<any>) {
    super()
    this[INTERNAL_SYMBOL] = new RecordRefInternals(params)
  }

  /** Set a value at a key */
  set(key: string, value: Infer<NestedShape>): void {
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

  /**
   * Returns an array of all values in the record.
   * For container-valued records, returns properly typed refs.
   */
  values(): InferMutableType<NestedShape>[] {
    // We know keys() only returns keys that exist, so get() will not return undefined
    return this.keys().map(
      key => this.get(key) as InferMutableType<NestedShape>,
    )
  }

  /**
   * Returns an array of [key, value] pairs.
   * For container-valued records, values are properly typed refs.
   */
  entries(): [string, InferMutableType<NestedShape>][] {
    // We know keys() only returns keys that exist, so get() will not return undefined
    return this.keys().map(key => [
      key,
      this.get(key) as InferMutableType<NestedShape>,
    ])
  }

  get size(): number {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.size
  }

  /**
   * Replace entire contents with new values.
   * Keys not in `values` are removed.
   *
   * @example
   * ```typescript
   * doc.change(draft => {
   *   draft.players.replace({
   *     alice: { score: 100 },
   *     bob: { score: 50 }
   *   })
   * })
   * ```
   */
  replace(values: Record<string, Infer<NestedShape>>): void {
    this[INTERNAL_SYMBOL].replace(values)
  }

  /**
   * Merge values into record.
   * Existing keys not in `values` are kept.
   *
   * @example
   * ```typescript
   * doc.change(draft => {
   *   // Adds charlie, updates alice, keeps bob unchanged
   *   draft.players.merge({
   *     alice: { score: 150 },
   *     charlie: { score: 25 }
   *   })
   * })
   * ```
   */
  merge(values: Record<string, Infer<NestedShape>>): void {
    this[INTERNAL_SYMBOL].merge(values)
  }

  /**
   * Remove all entries from the record.
   *
   * @example
   * ```typescript
   * doc.change(draft => {
   *   draft.players.clear()
   * })
   * ```
   */
  clear(): void {
    this[INTERNAL_SYMBOL].clear()
  }

  toJSON(): Record<string, Infer<NestedShape>> {
    return serializeRefToJSON(this, this.keys()) as Record<
      string,
      Infer<NestedShape>
    >
  }
}

/**
 * User-facing type for RecordRef that includes bracket access support.
 *
 * This type adds an index signature to RecordRef, allowing patterns like:
 * - Reading: `doc.players['alice']?.score`
 * - Writing: `draft.players['alice'] = { score: 100 }`
 *
 * The index signature is defined as a mapped type intersection to avoid
 * conflicting with the class methods (set, get, delete, etc.).
 *
 * At runtime, the Proxy wrapper (`recordProxyHandler`) handles bracket access
 * by delegating to the appropriate RecordRef methods.
 */
export type IndexedRecordRef<NestedShape extends ContainerOrValueShape> =
  RecordRef<NestedShape> & {
    /**
     * Access record entries by key using bracket notation.
     *
     * Reading returns the mutable ref type (e.g., StructRef) or undefined.
     * Writing accepts the plain value type (e.g., { score: number }).
     */
    [key: string]:
      | InferMutableType<NestedShape>
      | Infer<NestedShape>
      | undefined
  }
