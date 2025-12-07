import type { CounterContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Counter typed ref
export class CounterRef extends TypedRef<CounterContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  increment(value: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.increment(value)
  }

  decrement(value: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.decrement(value)
  }

  get value(): number {
    return this.container.value
  }
}
