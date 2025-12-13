import type { LoroText } from "loro-crdt"
import type { TextContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Text typed ref
export class TextRef extends TypedRef<TextContainerShape> {
  // Track if we've materialized the container (made any changes)
  private _materialized = false

  protected get container(): LoroText {
    return super.container as LoroText
  }

  absorbPlainValues() {
    // no plain values contained within
  }

  // Text methods
  insert(index: number, content: string): void {
    this.assertMutable()
    this._materialized = true
    this.container.insert(index, content)
    this.commitIfAuto()
  }

  delete(index: number, len: number): void {
    this.assertMutable()
    this._materialized = true
    this.container.delete(index, len)
    this.commitIfAuto()
  }

  /**
   * Returns the text content.
   * If the text hasn't been materialized (no operations performed),
   * returns the placeholder value if available.
   */
  toString(): string {
    const containerValue = this.container.toString()
    if (containerValue !== "" || this._materialized) {
      return containerValue
    }
    // Return placeholder if available and container is at default state
    if (this.placeholder !== undefined) {
      return this.placeholder as string
    }
    return containerValue
  }

  valueOf(): string {
    return this.toString()
  }

  toJSON(): string {
    return this.toString()
  }

  [Symbol.toPrimitive](_hint: string): string {
    return this.toString()
  }

  update(text: string): void {
    this.assertMutable()
    this._materialized = true
    this.container.update(text)
    this.commitIfAuto()
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.assertMutable()
    this._materialized = true
    this.container.mark(range, key, value)
    this.commitIfAuto()
  }

  unmark(range: { start: number; end: number }, key: string): void {
    this.assertMutable()
    this._materialized = true
    this.container.unmark(range, key)
    this.commitIfAuto()
  }

  toDelta(): any[] {
    return this.container.toDelta()
  }

  applyDelta(delta: any[]): void {
    this.assertMutable()
    this._materialized = true
    this.container.applyDelta(delta)
    this.commitIfAuto()
  }

  get length(): number {
    return this.container.length
  }
}
