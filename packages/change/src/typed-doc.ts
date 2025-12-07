/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import { LoroDoc } from "loro-crdt"
import { derivePlaceholder } from "./derive-placeholder.js"
import {
  type JsonPatch,
  JsonPatchApplicator,
  type JsonPatchOperation,
  normalizePath,
} from "./json-patch.js"
import { overlayPlaceholder } from "./overlay.js"
import type { DocShape } from "./shape.js"
import { DocRef } from "./typed-refs/doc.js"
import type {
  DeepReadonly,
  Draft,
  Infer,
  InferPlaceholderType,
} from "./types.js"
import { validatePlaceholder } from "./validation.js"

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<Shape extends DocShape> {
  private shape: Shape
  private placeholder: InferPlaceholderType<Shape>
  private doc: LoroDoc

  /**
   * Creates a new TypedDoc with the given schema.
   * Placeholder state is automatically derived from the schema's placeholder values.
   *
   * @param shape - The document schema (with optional .placeholder() values)
   * @param doc - Optional existing LoroDoc to wrap
   */
  constructor(shape: Shape, doc: LoroDoc = new LoroDoc()) {
    this.shape = shape
    this.placeholder = derivePlaceholder(shape)
    this.doc = doc

    validatePlaceholder(this.placeholder, this.shape)
  }

  /**
   * Returns a read-only, live view of the document.
   * Accessing properties on this object will read directly from the underlying CRDT.
   * This is efficient (O(1) per access) and always up-to-date.
   */
  get value(): DeepReadonly<Infer<Shape>> {
    return new DocRef({
      shape: this.shape,
      placeholder: this.placeholder as any,
      doc: this.doc,
      readonly: true,
    }) as unknown as DeepReadonly<Infer<Shape>>
  }

  /**
   * Returns the full plain JavaScript object representation of the document.
   * This is an expensive O(N) operation that serializes the entire document.
   */
  toJSON(): Infer<Shape> {
    const crdtValue = this.doc.toJSON()
    return overlayPlaceholder(
      this.shape,
      crdtValue,
      this.placeholder as any,
    ) as Infer<Shape>
  }

  change(fn: (draft: Draft<Shape>) => void): Infer<Shape> {
    // Reuse existing DocRef system with placeholder integration
    const draft = new DocRef({
      shape: this.shape,
      placeholder: this.placeholder as any,
      doc: this.doc,
    })
    fn(draft as unknown as Draft<Shape>)
    draft.absorbPlainValues()
    this.doc.commit()
    return this.toJSON()
  }

  /**
   * Apply JSON Patch operations to the document
   *
   * @param patch - Array of JSON Patch operations (RFC 6902)
   * @param pathPrefix - Optional path prefix for scoped operations
   * @returns Updated document value
   *
   * @example
   * ```typescript
   * const result = typedDoc.applyPatch([
   *   { op: 'add', path: '/users/0/name', value: 'Alice' },
   *   { op: 'replace', path: '/settings/theme', value: 'dark' }
   * ])
   * ```
   */
  applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): Infer<Shape> {
    return this.change(draft => {
      const applicator = new JsonPatchApplicator(draft)

      // Apply path prefix if provided
      const prefixedPatch = pathPrefix
        ? patch.map((op: JsonPatchOperation) => ({
            ...op,
            path: [...pathPrefix, ...normalizePath(op.path)],
          }))
        : patch

      applicator.applyPatch(prefixedPatch)
    })
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
  existingDoc?: LoroDoc,
): TypedDoc<Shape> {
  return new TypedDoc<Shape>(shape, existingDoc || new LoroDoc())
}
