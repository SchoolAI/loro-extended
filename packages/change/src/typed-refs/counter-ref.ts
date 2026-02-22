import type { CounterContainerShape } from "../shape.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import { CounterRefInternals } from "./counter-ref-internals.js"

/**
 * Counter typed ref - thin facade that delegates to CounterRefInternals.
 */
export class CounterRef extends TypedRef<CounterContainerShape> {
  [INTERNAL_SYMBOL]: CounterRefInternals

  constructor(params: TypedRefParams<CounterContainerShape>) {
    super()
    this[INTERNAL_SYMBOL] = new CounterRefInternals(params)
  }

  /** Increment the counter by the given value (default 1) */
  increment(value?: number): void {
    this[INTERNAL_SYMBOL].increment(value)
  }

  /** Decrement the counter by the given value (default 1) */
  decrement(value?: number): void {
    this[INTERNAL_SYMBOL].decrement(value)
  }

  /** Get the current counter value */
  get(): number {
    return this[INTERNAL_SYMBOL].getValue()
  }

  valueOf(): number {
    return this.get()
  }

  toJSON(): number {
    return this.get()
  }

  [Symbol.toPrimitive](hint: string): number | string {
    if (hint === "string") {
      return String(this.get())
    }
    return this.get()
  }
}
