/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import { LoroDoc, type Subscription } from "loro-crdt"
import { derivePlaceholder } from "./derive-placeholder.js"
import {
  type JsonPatch,
  JsonPatchApplicator,
  type JsonPatchOperation,
  normalizePath,
} from "./json-patch.js"
import { LORO_SYMBOL, type LoroTypedDocRef } from "./loro.js"
import { overlayPlaceholder } from "./overlay.js"
import type { DocShape } from "./shape.js"
import { DocRef } from "./typed-refs/doc.js"
import type { Infer, InferPlaceholderType, Mutable } from "./types.js"
import { validatePlaceholder } from "./validation.js"

/**
 * Meta-operations namespace for TypedDoc.
 * Access via doc.$ to perform batch operations, serialization, etc.
 */
export class TypedDocMeta<Shape extends DocShape> {
  constructor(private internal: TypedDocInternal<Shape>) {}

  /**
   * The primary method of mutating typed documents.
   * Batches multiple mutations into a single transaction.
   * All changes commit together at the end.
   *
   * Use this for:
   * - Find-and-mutate operations (required due to JS limitations)
   * - Performance (fewer commits)
   * - Atomic undo (all changes = one undo step)
   *
   * Returns the doc for chaining.
   */
  change(fn: (draft: Mutable<Shape>) => void): TypedDoc<Shape> {
    this.internal.change(fn)
    return this.internal.proxy as TypedDoc<Shape>
  }

  /**
   * Returns the full plain JavaScript object representation of the document.
   * This is an expensive O(N) operation that serializes the entire document.
   */
  toJSON(): Infer<Shape> {
    return this.internal.toJSON()
  }

  /**
   * Apply JSON Patch operations to the document
   *
   * @param patch - Array of JSON Patch operations (RFC 6902)
   * @param pathPrefix - Optional path prefix for scoped operations
   * @returns Updated document value
   */
  applyPatch(
    patch: JsonPatch,
    pathPrefix?: (string | number)[],
  ): TypedDoc<Shape> {
    this.internal.applyPatch(patch, pathPrefix)
    return this.internal.proxy as TypedDoc<Shape>
  }

  /**
   * Access the underlying LoroDoc for advanced operations.
   */
  get loroDoc(): LoroDoc {
    return this.internal.loroDoc
  }

  /**
   * Access the document schema shape.
   */
  get docShape(): Shape {
    return this.internal.docShape
  }

  /**
   * Get raw CRDT value without placeholder overlay.
   */
  get rawValue(): any {
    return this.internal.rawValue
  }
}

/**
 * Internal TypedDoc implementation (not directly exposed to users).
 * Users interact with the proxied version that provides direct schema access.
 */
class TypedDocInternal<Shape extends DocShape> {
  private shape: Shape
  private placeholder: InferPlaceholderType<Shape>
  private doc: LoroDoc
  private _valueRef: DocRef<Shape> | null = null
  // Reference to the proxy for returning from change()
  proxy: TypedDoc<Shape> | null = null

  constructor(shape: Shape, doc: LoroDoc = new LoroDoc()) {
    this.shape = shape
    this.placeholder = derivePlaceholder(shape)
    this.doc = doc

    validatePlaceholder(this.placeholder, this.shape)
  }

  get value(): Mutable<Shape> {
    if (!this._valueRef) {
      this._valueRef = new DocRef({
        shape: this.shape,
        placeholder: this.placeholder as any,
        doc: this.doc,
        autoCommit: true,
      })
    }
    return this._valueRef as unknown as Mutable<Shape>
  }

  toJSON(): Infer<Shape> {
    const crdtValue = this.doc.toJSON()
    return overlayPlaceholder(
      this.shape,
      crdtValue,
      this.placeholder as any,
    ) as Infer<Shape>
  }

  change(fn: (draft: Mutable<Shape>) => void): void {
    const draft = new DocRef({
      shape: this.shape,
      placeholder: this.placeholder as any,
      doc: this.doc,
      autoCommit: false,
      batchedMutation: true, // Enable value shape caching for find-and-mutate patterns
    })
    fn(draft as unknown as Mutable<Shape>)
    draft.absorbPlainValues()
    this.doc.commit()

    // Invalidate cached value ref since doc changed
    this._valueRef = null
  }

  applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): void {
    this.change(draft => {
      const applicator = new JsonPatchApplicator(draft)

      const prefixedPatch = pathPrefix
        ? patch.map((op: JsonPatchOperation) => ({
            ...op,
            path: [...pathPrefix, ...normalizePath(op.path)],
          }))
        : patch

      applicator.applyPatch(prefixedPatch)
    })
  }

  get loroDoc(): LoroDoc {
    return this.doc
  }

  get docShape(): Shape {
    return this.shape
  }

  get rawValue(): any {
    return this.doc.toJSON()
  }
}

/**
 * The proxied TypedDoc type that provides direct schema access.
 * Schema properties are accessed directly on the doc object.
 *
 * @example
 * ```typescript
 * const doc = createTypedDoc(schema);
 *
 * // Direct schema access
 * doc.count.increment(5);
 * doc.title.insert(0, "Hello");
 *
 * // Serialize to JSON (works on doc and all refs)
 * const snapshot = doc.toJSON();
 * const users = doc.users.toJSON();
 *
 * // Batched mutations via change()
 * doc.change(draft => {
 *   draft.count.increment(10);
 *   draft.title.update("World");
 * });
 *
 * // Access CRDT internals via loro()
 * import { loro } from "@loro-extended/change";
 * loro(doc).doc;  // LoroDoc
 * loro(doc).subscribe(callback);
 * ```
 */
export type TypedDoc<Shape extends DocShape> = Mutable<Shape> & {
  /**
   * The primary method of mutating typed documents.
   * Batches multiple mutations into a single transaction.
   * All changes commit together at the end.
   *
   * Use this for:
   * - Find-and-mutate operations (required due to JS limitations)
   * - Performance (fewer commits)
   * - Atomic undo (all changes = one undo step)
   *
   * Returns the doc for chaining.
   *
   * @example
   * ```typescript
   * doc.change(draft => {
   *   draft.count.increment(10);
   *   draft.title.update("World");
   * });
   * ```
   */
  change(fn: (draft: Mutable<Shape>) => void): TypedDoc<Shape>

  /**
   * Meta-operations namespace.
   * @deprecated Use `loro(doc)` instead for CRDT access, and `doc.change()` for mutations.
   */
  $: TypedDocMeta<Shape>

  /**
   * Returns the full plain JavaScript object representation of the document.
   * This is an O(N) operation that serializes the entire document.
   *
   * @example
   * ```typescript
   * const snapshot = doc.toJSON();
   * console.log(snapshot.count); // number
   * ```
   */
  toJSON(): Infer<Shape>
}

/**
 * Creates a new TypedDoc with the given schema.
 * Returns a proxied document where schema properties are accessed directly.
 *
 * @param shape - The document schema (with optional .placeholder() values)
 * @param existingDoc - Optional existing LoroDoc to wrap
 * @returns A proxied TypedDoc with direct schema access
 *
 * @example
 * ```typescript
 * const schema = Shape.doc({
 *   title: Shape.text(),
 *   count: Shape.counter(),
 * });
 *
 * const doc = createTypedDoc(schema);
 *
 * // Direct mutations (auto-commit)
 * doc.count.increment(5);
 * doc.title.insert(0, "Hello");
 *
 * // Batched mutations via change()
 * doc.change(draft => {
 *   draft.count.increment(10);
 *   draft.title.update("World");
 * });
 *
 * // Get plain JSON
 * const snapshot = doc.toJSON();
 *
 * // Access CRDT internals via loro()
 * import { loro } from "@loro-extended/change";
 * loro(doc).doc;  // LoroDoc
 * loro(doc).subscribe(callback);
 * ```
 */
export function createTypedDoc<Shape extends DocShape>(
  shape: Shape,
  existingDoc?: LoroDoc,
): TypedDoc<Shape> {
  const internal = new TypedDocInternal(shape, existingDoc || new LoroDoc())
  const meta = new TypedDocMeta(internal)

  // Create the loro() namespace for this doc
  const loroNamespace: LoroTypedDocRef = {
    get doc(): LoroDoc {
      return internal.loroDoc
    },
    get container(): LoroDoc {
      return internal.loroDoc
    },
    subscribe(callback: (event: unknown) => void): Subscription {
      return internal.loroDoc.subscribe(callback)
    },
    applyPatch(patch: JsonPatch, pathPrefix?: (string | number)[]): void {
      internal.applyPatch(patch, pathPrefix)
    },
    get docShape(): DocShape {
      return internal.docShape
    },
    get rawValue(): unknown {
      return internal.rawValue
    },
  }

  // Create the change() function that returns the proxy for chaining
  const changeFunction = (
    fn: (draft: Mutable<Shape>) => void,
  ): TypedDoc<Shape> => {
    internal.change(fn)
    return proxy
  }

  // Create a proxy that delegates schema properties to the DocRef
  // and provides change() and $ namespace
  const proxy = new Proxy(internal.value as object, {
    get(target, prop, receiver) {
      // loro() access via well-known symbol
      if (prop === LORO_SYMBOL) {
        return loroNamespace
      }

      // change() method directly on doc
      if (prop === "change") {
        return changeFunction
      }

      // $ namespace for meta-operations (deprecated, kept for backward compatibility)
      if (prop === "$") {
        return meta
      }

      // toJSON() should always read fresh from the CRDT
      if (prop === "toJSON") {
        return () => internal.toJSON()
      }

      // Delegate to the DocRef (which is the target)
      return Reflect.get(target, prop, receiver)
    },

    set(target, prop, value, receiver) {
      // Don't allow setting $, change, or LORO_SYMBOL
      if (prop === "$" || prop === LORO_SYMBOL || prop === "change") {
        return false
      }

      // Delegate to the DocRef
      return Reflect.set(target, prop, value, receiver)
    },

    // Support 'in' operator
    has(target, prop) {
      if (prop === "$" || prop === LORO_SYMBOL || prop === "change") return true
      return Reflect.has(target, prop)
    },

    // Support Object.keys() - don't include $, change, or LORO_SYMBOL in enumeration
    ownKeys(target) {
      return Reflect.ownKeys(target)
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop === "$") {
        return {
          configurable: true,
          enumerable: false,
          value: meta,
        }
      }
      if (prop === "change") {
        return {
          configurable: true,
          enumerable: false,
          value: changeFunction,
        }
      }
      if (prop === LORO_SYMBOL) {
        return {
          configurable: true,
          enumerable: false,
          value: loroNamespace,
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  }) as TypedDoc<Shape>

  // Store reference to proxy for returning from change()
  internal.proxy = proxy

  return proxy
}
