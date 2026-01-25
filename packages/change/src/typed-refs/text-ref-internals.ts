import type { LoroDoc, LoroEventBatch, LoroText, Subscription } from "loro-crdt"
import type { LoroTextRef } from "../loro.js"
import type { TextContainerShape } from "../shape.js"
import { BaseRefInternals } from "./base.js"

/**
 * Internal implementation for TextRef.
 * Contains all logic, state, and implementation details.
 */
export class TextRefInternals extends BaseRefInternals<TextContainerShape> {
  private materialized = false

  /** Insert text at the given index */
  insert(index: number, content: string): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).insert(index, content)
    this.commitIfAuto()
  }

  /** Delete text at the given index */
  delete(index: number, len: number): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).delete(index, len)
    this.commitIfAuto()
  }

  /** Update the entire text content */
  update(text: string): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).update(text)
    this.commitIfAuto()
  }

  /** Mark a range of text with a key-value pair */
  mark(range: { start: number; end: number }, key: string, value: any): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).mark(range, key, value)
    this.commitIfAuto()
  }

  /** Remove a mark from a range of text */
  unmark(range: { start: number; end: number }, key: string): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).unmark(range, key)
    this.commitIfAuto()
  }

  /** Apply a delta to the text */
  applyDelta(delta: any[]): void {
    this.materialized = true
    ;(this.getContainer() as LoroText).applyDelta(delta)
    this.commitIfAuto()
  }

  /** Get the text as a string */
  getStringValue(): string {
    const container = this.getContainer() as LoroText
    const containerValue = container.toString()
    if (containerValue !== "" || this.materialized) {
      return containerValue
    }
    // Return placeholder if available and container is at default state
    const placeholder = this.getPlaceholder()
    if (placeholder !== undefined) {
      return placeholder as string
    }
    return containerValue
  }

  /** Get the text as a delta */
  toDelta(): any[] {
    return (this.getContainer() as LoroText).toDelta()
  }

  /** Get the length of the text */
  getLength(): number {
    return (this.getContainer() as LoroText).length
  }

  /** No plain values in text */
  absorbPlainValues(): void {
    // no plain values contained within
  }

  /** Create the loro namespace for text */
  protected override createLoroNamespace(): LoroTextRef {
    const self = this
    return {
      get doc(): LoroDoc {
        return self.getDoc()
      },
      get container(): LoroText {
        return self.getContainer() as LoroText
      },
      subscribe(callback: (event: LoroEventBatch) => void): Subscription {
        return (self.getContainer() as LoroText).subscribe(callback)
      },
    }
  }
}
