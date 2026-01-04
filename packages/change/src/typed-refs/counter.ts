import type { LoroCounter } from "loro-crdt"
import type { CounterContainerShape } from "../shape.js"
import { INTERNAL_SYMBOL, type RefInternals, TypedRef } from "./base.js"

// Counter typed ref
export class CounterRef extends TypedRef<CounterContainerShape> {
  // Track if we've materialized the container (made any changes)
  private _materialized = false

  protected get container(): LoroCounter {
    return super.container as LoroCounter
  }

  [INTERNAL_SYMBOL]: RefInternals = {


    absorbPlainValues: () => {
    // no plain values contained within
  },


  }

  increment(value: number = 1): void {
    this._materialized = true
    this.container.increment(value)
    this.commitIfAuto()
  }

  decrement(value: number = 1): void {
    this._materialized = true
    this.container.decrement(value)
    this.commitIfAuto()
  }

  /**
   * Returns the counter value.
   * If the counter hasn't been materialized (no operations performed),
   * returns the placeholder value if available.
   */
  get value(): number {
    // Check if the container has any value (non-zero means it was modified)
    const containerValue = this.container.value
    if (containerValue !== 0 || this._materialized) {
      return containerValue
    }
    // Return placeholder if available and container is at default state
    if (this.placeholder !== undefined) {
      return this.placeholder as number
    }
    return containerValue
  }

  valueOf(): number {
    return this.value
  }

  toJSON(): number {
    return this.value
  }

  [Symbol.toPrimitive](hint: string): number | string {
    if (hint === "string") {
      return String(this.value)
    }
    return this.value
  }
}
