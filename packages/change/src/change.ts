/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import { LoroDoc } from "loro-crdt"
import { DraftDoc } from "./draft-nodes/doc.js"
import {
  type JsonPatch,
  JsonPatchApplicator,
  type JsonPatchOperation,
  normalizePath,
} from "./json-patch.js"
import { overlayEmptyState } from "./overlay.js"
import type { DocShape } from "./shape.js"
import type { Draft, InferEmptyStateType, InferPlainType } from "./types.js"
import { validateEmptyState } from "./validation.js"

// Core TypedDoc abstraction around LoroDoc
export class TypedDoc<Shape extends DocShape> {
  /**
   * Creates a new TypedDoc with the given schema and empty state.
   *
   * @param shape - The document schema
   * @param emptyState - Default values for the document. For dynamic containers
   *   (list, record, etc.), only empty values ([] or {}) are allowed. Use
   *   `.change()` to add initial data after construction.
   * @param doc - Optional existing LoroDoc to wrap
   */
  constructor(
    private shape: Shape,
    private emptyState: InferEmptyStateType<Shape>,
    private doc: LoroDoc = new LoroDoc(),
  ) {
    validateEmptyState(emptyState, shape)
  }

  get value(): InferPlainType<Shape> {
    const crdtValue = this.doc.toJSON()
    return overlayEmptyState(
      this.shape,
      crdtValue,
      this.emptyState as any,
    ) as InferPlainType<Shape>
  }

  change(fn: (draft: Draft<Shape>) => void): InferPlainType<Shape> {
    // Reuse existing DocumentDraft system with empty state integration
    const draft = new DraftDoc({
      shape: this.shape,
      emptyState: this.emptyState as any,
      doc: this.doc,
    })
    fn(draft as unknown as Draft<Shape>)
    draft.absorbPlainValues()
    this.doc.commit()
    return this.value
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
  applyPatch(
    patch: JsonPatch,
    pathPrefix?: (string | number)[],
  ): InferPlainType<Shape> {
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
  emptyState: InferEmptyStateType<Shape>,
  existingDoc?: LoroDoc,
): TypedDoc<Shape> {
  return new TypedDoc<Shape>(shape, emptyState, existingDoc || new LoroDoc())
}
