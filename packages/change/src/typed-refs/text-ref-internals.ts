import type {
  Delta,
  LoroDoc,
  LoroEventBatch,
  LoroText,
  Subscription,
  TextDiff,
} from "loro-crdt"
import type { ExtRefBase } from "../ext.js"
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
    const overlay = this.getOverlay()
    if (overlay) {
      const diff = overlay.get(container.id)
      if (diff && diff.type === "text") {
        const containerValue = container.toString()
        return applyTextDelta(containerValue, (diff as TextDiff).diff)
      }
    }
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
    const container = this.getContainer() as LoroText
    const overlay = this.getOverlay()
    if (overlay) {
      const diff = overlay.get(container.id)
      if (diff && diff.type === "text") {
        const base = container.toDelta() as Delta<string>[]
        return applyDeltaToDelta(base, (diff as TextDiff).diff)
      }
    }
    return container.toDelta()
  }

  /** Get the length of the text */
  getLength(): number {
    const container = this.getContainer() as LoroText
    const overlay = this.getOverlay()
    if (overlay) {
      const diff = overlay.get(container.id)
      if (diff && diff.type === "text") {
        return applyTextDelta(container.toString(), (diff as TextDiff).diff)
          .length
      }
    }
    return container.length
  }

  /** No plain values in text */
  absorbPlainValues(): void {
    // no plain values contained within
  }

  /** Create the ext namespace for text */
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
        return (self.getContainer() as LoroText).subscribe(callback)
      },
    }
  }
}

function applyTextDelta(text: string, delta: Delta<string>[]): string {
  let result = ""
  let index = 0

  for (const op of delta) {
    if (op.retain !== undefined) {
      result += text.slice(index, index + op.retain)
      index += op.retain
    } else if (op.delete !== undefined) {
      index += op.delete
    } else if (op.insert !== undefined) {
      result += op.insert
    }
  }

  if (index < text.length) {
    result += text.slice(index)
  }

  return result
}

function applyDeltaToDelta(
  base: Delta<string>[],
  diff: Delta<string>[],
): Delta<string>[] {
  const baseText = base
    .map(op => (op.insert !== undefined ? op.insert : ""))
    .join("")
  const nextText = applyTextDelta(baseText, diff)
  return nextText ? [{ insert: nextText }] : []
}
