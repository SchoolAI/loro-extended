import type { CounterContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Counter typed ref
export class CounterRef extends TypedRef<CounterContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  increment(value: number): void {
    this.assertMutable()
    this.container.increment(value)
  }

  decrement(value: number): void {
    this.assertMutable()
    this.container.decrement(value)
  }

  get value(): number {
    return this.container.value
  }

  toJSON(): number {
    return this.value
  }
}
