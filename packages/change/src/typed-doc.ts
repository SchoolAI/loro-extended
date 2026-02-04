/** biome-ignore-all lint/suspicious/noExplicitAny: fix later */

import {
  LoroDoc,
  type LoroEventBatch,
  type PeerID,
  type Subscription,
  type Value,
} from "loro-crdt"
import { derivePlaceholder } from "./derive-placeholder.js"
import {
  type JsonPatch,
  JsonPatchApplicator,
  type JsonPatchOperation,
  normalizePath,
} from "./json-patch.js"
import { LORO_SYMBOL, type LoroTypedDocRef } from "./loro.js"
import {
  hasMetadata,
  isLoroExtendedReservedKey,
  readMetadata,
  writeMetadata,
} from "./metadata.js"
import { overlayPlaceholder } from "./overlay.js"
import { buildRootContainerName } from "./path-encoding.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DocShape,
  RecordContainerShape,
  StructContainerShape,
} from "./shape.js"
import { type DiffOverlay, INTERNAL_SYMBOL } from "./typed-refs/base.js"
import { DocRef } from "./typed-refs/doc-ref.js"
import type { Infer, InferPlaceholderType, Mutable } from "./types.js"
import { isValueShape } from "./utils/type-guards.js"
import { validatePlaceholder } from "./validation.js"

/**
 * Reconstructs hierarchical structure from flattened root container storage.
 * Used when `mergeable: true` to convert the flat storage back to nested objects.
 *
 * @param flatValue - The raw flattened value from doc.toJSON()
 * @param shape - The document shape
 * @param pathPrefix - Current path prefix for looking up child containers
 * @returns Reconstructed hierarchical value
 */
function reconstructFromFlattened(
  flatValue: Record<string, Value>,
  shape: ContainerShape,
  pathPrefix: string[],
): Value {
  switch (shape._type) {
    case "struct": {
      const structShape = shape as StructContainerShape
      const result: Record<string, Value> = {}

      for (const [key, nestedShape] of Object.entries(structShape.shapes)) {
        if (isValueShape(nestedShape)) {
          // Value shapes are stored directly in the container
          const containerName = buildRootContainerName(pathPrefix)
          const container = flatValue[containerName] as Record<string, Value>
          if (container && key in container) {
            result[key] = container[key]
          }
        } else {
          // Container shapes are stored as separate root containers
          const childPath = [...pathPrefix, key]
          result[key] = reconstructFromFlattened(
            flatValue,
            nestedShape as ContainerShape,
            childPath,
          )
        }
      }

      return result
    }

    case "record": {
      const recordShape = shape as RecordContainerShape<ContainerOrValueShape>
      const containerName = buildRootContainerName(pathPrefix)
      const container = flatValue[containerName] as Record<string, Value>

      if (!container) {
        return {}
      }

      const result: Record<string, Value> = {}

      for (const key of Object.keys(container)) {
        const value = container[key]

        if (isValueShape(recordShape.shape)) {
          // Value shapes are stored directly
          result[key] = value
        } else if (value === null) {
          // null marker indicates a child container
          const childPath = [...pathPrefix, key]
          result[key] = reconstructFromFlattened(
            flatValue,
            recordShape.shape as ContainerShape,
            childPath,
          )
        } else {
          // Non-null value (shouldn't happen for container shapes, but handle gracefully)
          result[key] = value
        }
      }

      return result
    }

    case "list":
    case "movableList": {
      // Lists store their items directly in the root container
      const containerName = buildRootContainerName(pathPrefix)
      const container = flatValue[containerName]
      return container ?? []
    }

    case "text": {
      const containerName = buildRootContainerName(pathPrefix)
      const container = flatValue[containerName]
      return container ?? ""
    }

    case "counter": {
      const containerName = buildRootContainerName(pathPrefix)
      const container = flatValue[containerName]
      return container ?? 0
    }

    case "tree": {
      const containerName = buildRootContainerName(pathPrefix)
      const container = flatValue[containerName]
      return container ?? []
    }

    default:
      return {}
  }
}

/**
 * Reconstructs the full document hierarchy from flattened storage.
 * Excludes all `_loro_extended*` prefixed keys from the output.
 */
function reconstructDocFromFlattened(
  flatValue: Record<string, Value>,
  docShape: DocShape,
): Record<string, Value> {
  const result: Record<string, Value> = {}

  for (const [key, containerShape] of Object.entries(docShape.shapes)) {
    // Skip reserved keys (shouldn't be in schema, but be defensive)
    if (isLoroExtendedReservedKey(key)) {
      continue
    }
    result[key] = reconstructFromFlattened(flatValue, containerShape, [key])
  }

  return result
}

/**
 * Filters out reserved `_loro_extended*` keys from a raw CRDT value.
 */
function filterReservedKeys(
  crdtValue: Record<string, Value>,
): Record<string, Value> {
  const result: Record<string, Value> = {}
  for (const [key, value] of Object.entries(crdtValue)) {
    if (!isLoroExtendedReservedKey(key)) {
      result[key] = value
    }
  }
  return result
}

/**
 * Internal TypedDoc implementation (not directly exposed to users).
 * Users interact with the proxied version that provides direct schema access.
 */
class TypedDocInternal<Shape extends DocShape> {
  private shape: Shape
  private placeholder: InferPlaceholderType<Shape>
  private doc: LoroDoc
  private overlay?: DiffOverlay
  private _mergeable: boolean
  private _initialized: boolean
  private valueRef: DocRef<Shape> | null = null
  // Reference to the proxy for returning from change()
  proxy: TypedDoc<Shape> | null = null

  constructor(
    shape: Shape,
    doc: LoroDoc = new LoroDoc(),
    overlay?: DiffOverlay,
    schemaMergeable = false,
    skipInitialize = false,
  ) {
    this.shape = shape
    this.placeholder = derivePlaceholder(shape)
    this.doc = doc
    this.overlay = overlay

    // Determine effective mergeable setting with metadata integration
    // Priority: existing metadata > schema setting > false
    if (hasMetadata(doc)) {
      // Document has metadata - use it (metadata takes precedence over schema)
      const meta = readMetadata(doc)
      this._mergeable = meta.mergeable ?? false
      this._initialized = true
    } else {
      // No metadata - this is a new document or legacy document
      this._mergeable = schemaMergeable
      this._initialized = false

      // Auto-initialize unless skipInitialize is true
      if (!skipInitialize) {
        this.initialize()
      }
    }

    validatePlaceholder(this.placeholder, this.shape)
  }

  /**
   * Initialize the document by writing metadata.
   * This is called automatically unless `skipInitialize: true` was passed.
   * Call this manually if you skipped initialization and want to write metadata later.
   */
  initialize(): void {
    if (this._initialized) return
    writeMetadata(this.doc, { mergeable: this._mergeable })
    this._initialized = true
  }

  get initialized(): boolean {
    return this._initialized
  }

  get mergeable(): boolean {
    return this._mergeable
  }

  get value(): Mutable<Shape> {
    if (!this.valueRef) {
      this.valueRef = new DocRef({
        shape: this.shape,
        placeholder: this.placeholder as any,
        doc: this.doc,
        autoCommit: true,
        overlay: this.overlay,
        mergeable: this._mergeable,
      })
    }
    return this.valueRef as unknown as Mutable<Shape>
  }

  toJSON(): Infer<Shape> {
    const crdtValue = this.doc.toJSON()

    // For mergeable docs, reconstruct hierarchy from flattened storage
    // For non-mergeable docs, just filter out reserved keys
    const hierarchicalValue = this._mergeable
      ? reconstructDocFromFlattened(crdtValue, this.shape)
      : filterReservedKeys(crdtValue)

    return overlayPlaceholder(
      this.shape,
      hierarchicalValue,
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
      overlay: this.overlay,
      mergeable: this._mergeable,
    })
    fn(draft as unknown as Mutable<Shape>)
    draft[INTERNAL_SYMBOL].absorbPlainValues()
    this.doc.commit()

    // Invalidate cached value ref since doc changed
    this.valueRef = null
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
    // Filter out reserved keys from raw value
    return filterReservedKeys(this.doc.toJSON())
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
/**
 * Frontiers represent a specific version in the document's history.
 * Each frontier is an operation ID consisting of a peer ID and counter.
 */
export type Frontiers = { peer: PeerID; counter: number }[]

export type CreateTypedDocOptions = {
  doc?: LoroDoc
  overlay?: DiffOverlay
  /**
   * When true, all containers are stored at the document root with path-based names.
   * This ensures container IDs are deterministic and survive `applyDiff`, enabling
   * proper merging of concurrent container creation.
   *
   * Use this when:
   * - Multiple peers may concurrently create containers at the same schema path
   * - You need containers to merge correctly via `applyDiff` (e.g., Lens)
   *
   * Limitations:
   * - Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported
   * - MovableLists of containers are NOT supported
   * - Use `Shape.record(Shape.struct({...}))` with string keys instead
   *
   * @default false
   */
  mergeable?: boolean
  /**
   * When true, skip automatic metadata initialization.
   * Use this when:
   * - Receiving a synced document (it already has metadata)
   * - You want to control when metadata is written (call `initialize()` later)
   * - Testing scenarios where you need an empty document
   *
   * @default false
   */
  skipInitialize?: boolean
}

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

  /**
   * Creates a new TypedDoc at a specified version (frontiers).
   * The forked doc will only contain history before the specified frontiers.
   * The forked doc has a different PeerID from the original.
   *
   * For raw LoroDoc access, use: `loro(doc).doc.forkAt(frontiers)`
   *
   * @param frontiers - The version to fork at (obtained from `loro(doc).doc.frontiers()`)
   * @returns A new TypedDoc with the same schema at the specified version
   *
   * @example
   * ```typescript
   * import { loro } from "@loro-extended/change";
   *
   * const doc = createTypedDoc(schema);
   * doc.title.update("Hello");
   * const frontiers = loro(doc).doc.frontiers();
   * doc.title.update("World");
   *
   * // Fork at the earlier version
   * const forkedDoc = doc.forkAt(frontiers);
   * console.log(forkedDoc.title.toString()); // "Hello"
   * console.log(doc.title.toString()); // "World"
   * ```
   */
  forkAt(frontiers: Frontiers): TypedDoc<Shape>

  /**
   * Initialize the document by writing metadata.
   * This is called automatically unless `skipInitialize: true` was passed to createTypedDoc.
   * Call this manually if you skipped initialization and want to write metadata later.
   *
   * This is idempotent - calling it multiple times has no effect after the first call.
   *
   * @example
   * ```typescript
   * // Create doc without auto-initialization
   * const doc = createTypedDoc(schema, { skipInitialize: true });
   *
   * // Later, when ready to write metadata
   * doc.initialize();
   * ```
   */
  initialize(): void
}

/**
 * Creates a new TypedDoc with the given schema.
 * Returns a proxied document where schema properties are accessed directly.
 *
 * @param shape - The document schema (with optional .placeholder() values)
 * @param options - Optional existing LoroDoc or diff overlay
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
  options: CreateTypedDocOptions = {},
): TypedDoc<Shape> {
  // Determine effective mergeable setting: options > schema > false
  const effectiveMergeable = options.mergeable ?? shape.mergeable ?? false

  const internal = new TypedDocInternal(
    shape,
    options.doc || new LoroDoc(),
    options.overlay,
    effectiveMergeable,
    options.skipInitialize ?? false,
  )

  // Create the loro() namespace for this doc
  const loroNamespace: LoroTypedDocRef = {
    get doc(): LoroDoc {
      return internal.loroDoc
    },
    get container(): LoroDoc {
      return internal.loroDoc
    },
    subscribe(callback: (event: LoroEventBatch) => void): Subscription {
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
    get mergeable(): boolean {
      return internal.mergeable
    },
  }

  // Create the change() function that returns the proxy for chaining
  const changeFunction = (
    fn: (draft: Mutable<Shape>) => void,
  ): TypedDoc<Shape> => {
    internal.change(fn)
    return proxy
  }

  // Create the forkAt() function that returns a new TypedDoc at the specified version
  const forkAtFunction = (frontiers: Frontiers): TypedDoc<Shape> => {
    const forkedLoroDoc = internal.loroDoc.forkAt(frontiers)
    return createTypedDoc(internal.docShape, {
      doc: forkedLoroDoc,
      mergeable: internal.mergeable,
    })
  }

  // Create the initialize() function
  const initializeFunction = (): void => {
    internal.initialize()
  }

  // Create a proxy that delegates schema properties to the DocRef
  // and provides change() and forkAt() methods
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

      // forkAt() method directly on doc
      if (prop === "forkAt") {
        return forkAtFunction
      }

      // initialize() method directly on doc
      if (prop === "initialize") {
        return initializeFunction
      }

      // toJSON() should always read fresh from the CRDT
      if (prop === "toJSON") {
        return () => internal.toJSON()
      }

      // Delegate to the DocRef (which is the target)
      return Reflect.get(target, prop, receiver)
    },

    set(target, prop, value, receiver) {
      // Don't allow setting change, forkAt, initialize, or LORO_SYMBOL
      if (
        prop === LORO_SYMBOL ||
        prop === "change" ||
        prop === "forkAt" ||
        prop === "initialize"
      ) {
        return false
      }

      // Delegate to the DocRef
      return Reflect.set(target, prop, value, receiver)
    },

    // Support 'in' operator
    has(target, prop) {
      if (
        prop === LORO_SYMBOL ||
        prop === "change" ||
        prop === "forkAt" ||
        prop === "initialize"
      )
        return true
      return Reflect.has(target, prop)
    },

    // Support Object.keys() - filter out Symbol properties to allow proxies to be used
    // in place of plain objects. This prevents React's "Object keys must be strings" error.
    ownKeys(target) {
      return Reflect.ownKeys(target).filter(key => typeof key === "string")
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop === "change") {
        return {
          configurable: true,
          enumerable: false,
          value: changeFunction,
        }
      }
      if (prop === "forkAt") {
        return {
          configurable: true,
          enumerable: false,
          value: forkAtFunction,
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
