import type { TextContainerShape } from "../shape.js"
import { TypedRef } from "./base.js"

// Text typed ref
export class TextRef extends TypedRef<TextContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  // Text methods
  insert(index: number, content: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.insert(index, content)
  }

  delete(index: number, len: number): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.delete(index, len)
  }

  toString(): string {
    return this.container.toString()
  }

  update(text: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.update(text)
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.mark(range, key, value)
  }

  unmark(range: { start: number; end: number }, key: string): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.unmark(range, key)
  }

  toDelta(): any[] {
    return this.container.toDelta()
  }

  applyDelta(delta: any[]): void {
    if (this.readonly) throw new Error("Cannot modify readonly ref")
    this.container.applyDelta(delta)
  }

  get length(): number {
    return this.container.length
  }
}
