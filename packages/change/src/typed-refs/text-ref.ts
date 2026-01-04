import type { TextContainerShape } from "../shape.js"
import { INTERNAL_SYMBOL, TypedRef, type TypedRefParams } from "./base.js"
import { TextRefInternals } from "./text-ref-internals.js"

/**
 * Text typed ref - thin facade that delegates to TextRefInternals.
 */
export class TextRef extends TypedRef<TextContainerShape> {
  [INTERNAL_SYMBOL]: TextRefInternals

  constructor(params: TypedRefParams<TextContainerShape>) {
    super()
    this[INTERNAL_SYMBOL] = new TextRefInternals(params)
  }

  /** Insert text at the given index */
  insert(index: number, content: string): void {
    this[INTERNAL_SYMBOL].insert(index, content)
  }

  /** Delete text at the given index */
  delete(index: number, len: number): void {
    this[INTERNAL_SYMBOL].delete(index, len)
  }

  /** Update the entire text content */
  update(text: string): void {
    this[INTERNAL_SYMBOL].update(text)
  }

  /** Mark a range of text with a key-value pair */
  mark(range: { start: number; end: number }, key: string, value: any): void {
    this[INTERNAL_SYMBOL].mark(range, key, value)
  }

  /** Remove a mark from a range of text */
  unmark(range: { start: number; end: number }, key: string): void {
    this[INTERNAL_SYMBOL].unmark(range, key)
  }

  /** Apply a delta to the text */
  applyDelta(delta: any[]): void {
    this[INTERNAL_SYMBOL].applyDelta(delta)
  }

  /** Get the text as a string */
  toString(): string {
    return this[INTERNAL_SYMBOL].getStringValue()
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

  /** Get the text as a delta */
  toDelta(): any[] {
    return this[INTERNAL_SYMBOL].toDelta()
  }

  /** Get the length of the text */
  get length(): number {
    return this[INTERNAL_SYMBOL].getLength()
  }
}
