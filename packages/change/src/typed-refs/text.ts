import type { TextContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Text typed ref
export class TextRef extends TypedRef<TextContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  // Text methods
  insert(index: number, content: string): void {
    this.assertMutable()
    this.container.insert(index, content)
  }

  delete(index: number, len: number): void {
    this.assertMutable()
    this.container.delete(index, len)
  }

  toString(): string {
    return this.container.toString()
  }

  toJSON(): string {
    return this.toString()
  }

  update(text: string): void {
    this.assertMutable()
    this.container.update(text)
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.assertMutable()
    this.container.mark(range, key, value)
  }

  unmark(range: { start: number; end: number }, key: string): void {
    this.assertMutable()
    this.container.unmark(range, key)
  }

  toDelta(): any[] {
    return this.container.toDelta()
  }

  applyDelta(delta: any[]): void {
    this.assertMutable()
    this.container.applyDelta(delta)
  }

  get length(): number {
    return this.container.length
  }
}
