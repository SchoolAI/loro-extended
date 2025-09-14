import type { CounterContainerShape } from "../shape.js"
import { DraftNode } from "./base.js"

// Counter draft node
export class CounterDraftNode extends DraftNode<CounterContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  increment(value: number): void {
    this.container.increment(value)
  }

  decrement(value: number): void {
    this.container.decrement(value)
  }

  get value(): number {
    return this.container.value
  }
}
