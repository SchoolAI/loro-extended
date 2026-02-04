import type {
  CounterDiff,
  LoroCounter,
  LoroDoc,
  LoroEventBatch,
  Subscription,
} from "loro-crdt"
import type { ExtRefBase } from "../ext.js"
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
    const overlay = this.getOverlay()
    if (overlay) {
      const diff = overlay.get((container as any).id)
      if (diff && diff.type === "counter") {
        const counterDiff = diff as CounterDiff
        return containerValue + counterDiff.increment
      }
    }
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

  /** Create the ext namespace for counter */
  protected override createExtNamespace(): ExtRefBase {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      change<T>(_fn: (draft: T) => void): T {
        throw new Error(
          "Use the change() functional helper for ref-level changes: change(ref, fn)",
        )
      },
      subscribe(callback: (event: LoroEventBatch) => void): Subscription {
        return (self.getContainer() as LoroCounter).subscribe(callback)
      },
    }
  }
}
