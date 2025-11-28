import type { TextContainerShape } from "../shape.js"
import { DraftNode } from "./base.js"

// Text draft node
export class TextDraftNode extends DraftNode<TextContainerShape> {
  absorbPlainValues() {
    // no plain values contained within
  }

  // Text methods
  insert(index: number, content: string): void {
    this.container.insert(index, content)
  }

  delete(index: number, len: number): void {
    this.container.delete(index, len)
  }

  toString(): string {
    return this.container.toString()
  }

  update(text: string): void {
    this.container.update(text)
  }

  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.container.mark(range, key, value)
  }

  unmark(range: { start: number; end: number }, key: string): void {
    this.container.unmark(range, key)
  }

  toDelta(): any[] {
    return this.container.toDelta()
  }

  applyDelta(delta: any[]): void {
    this.container.applyDelta(delta)
  }

  get length(): number {
    return this.container.length
  }
}
