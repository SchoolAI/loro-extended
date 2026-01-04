import type { LoroCounter, LoroDoc, Subscription } from "loro-crdt"
import type { LoroCounterRef } from "../loro.js"
import type { CounterContainerShape } from "../shape.js"
import { BaseRefInternals } from "./base.js"

/**
 * Internal implementation for CounterRef.
 * Contains all logic, state, and implementation details.
 */
export class CounterRefInternals extends BaseRefInternals<CounterContainerShape> {
  private materialized = false

  /** Increment the counter value */
  increment(value: number = 1): void {
    this.materialized = true
    ;(this.getContainer() as LoroCounter).increment(value)
    this.commitIfAuto()
  }

  /** Decrement the counter value */
  decrement(value: number = 1): void {
    this.materialized = true
    ;(this.getContainer() as LoroCounter).decrement(value)
    this.commitIfAuto()
  }

  /** Get the current counter value */
  getValue(): number {
    const container = this.getContainer() as LoroCounter
    const containerValue = container.value
    if (containerValue !== 0 || this.materialized) {
      return containerValue
    }
    // Return placeholder if available and container is at default state
    const placeholder = this.getPlaceholder()
    if (placeholder !== undefined) {
      return placeholder as number
    }
    return containerValue
  }

  /** No plain values in counter */
  absorbPlainValues(): void {
    // no plain values contained within
  }

  /** Create the loro namespace for counter */
  protected override createLoroNamespace(): LoroCounterRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      get container(): LoroCounter {
        return self.getContainer() as LoroCounter
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return (self.getContainer() as LoroCounter).subscribe(callback)
      },
    }
  }
}
