/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import { LoroDoc } from "loro-crdt"
import { DraftDoc } from "./draft-nodes/doc.js"
import { overlayEmptyState } from "./overlay.js"
import type { DocShape } from "./shape.js"
import type { Draft, InferPlainType } from "./types.js"
import { validateEmptyState } from "./validation.js"

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<Shape extends DocShape> {
  constructor(
    private shape: Shape,
    private emptyState: InferPlainType<Shape>,
    private doc: LoroDoc = new LoroDoc(),
  ) {
    validateEmptyState(emptyState, shape)
  }

  get value(): InferPlainType<Shape> {
    const crdtValue = this.doc.toJSON()
    return overlayEmptyState(
      this.shape,
      crdtValue,
      this.emptyState,
    ) as InferPlainType<Shape>
  }

  change(fn: (draft: Draft<Shape>) => void): InferPlainType<Shape> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DraftDoc({
      shape: this.shape,
      emptyState: this.emptyState,
      doc: this.doc,
    })
    fn(draft as unknown as Draft<Shape>)
    draft.absorbPlainValues()
    this.doc.commit()
    return this.value
  }

  // Expose underlying doc for advanced use cases
  get loroDoc(): LoroDoc {
    return this.doc
  }

  // Expose shape for internal use
  get docShape(): Shape {
    return this.shape
  }

  // Get raw CRDT value without overlay
  get rawValue(): any {
    return this.doc.toJSON()
  }
}

// Factory function for TypedLoroDoc
export function createTypedDoc<Shape extends DocShape>(
  shape: Shape,
  emptyState: InferPlainType<Shape>,
  existingDoc?: LoroDoc,
): TypedDoc<Shape> {
  return new TypedDoc<Shape>(shape, emptyState, existingDoc || new LoroDoc())
}
