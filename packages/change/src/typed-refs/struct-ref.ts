import type { Container, LoroMap, Value } from "loro-crdt"
import { EXT_SYMBOL } from "../ext.js"
import { LORO_SYMBOL } from "../loro.js"
import type {
  ContainerOrValueShape,
  RefMode,
  SelectByMode,
  StructContainerShape,
} from "../shape.js"
import type { Infer } from "../types.js"
import {
  INTERNAL_SYMBOL,
  type RefInternalsBase,
  TypedRef,
  type TypedRefParams,
} from "./base.js"
import { StructRefInternals } from "./struct-ref-internals.js"
import { serializeRefToJSON } from "./utils.js"

/**
 * Internal implementation class for struct containers.
 * The actual StructRef is a Proxy wrapping this class.
 */
class StructRefImpl<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends TypedRef<any> {
  [INTERNAL_SYMBOL]: StructRefInternals<NestedShapes>

  constructor(params: TypedRefParams<any>) {
    super()
    this[INTERNAL_SYMBOL] = new StructRefInternals(params)
  }

  get structShape(): StructContainerShape<NestedShapes> {
    return this[
      INTERNAL_SYMBOL
    ].getShape() as StructContainerShape<NestedShapes>
  }

  toJSON(): Infer<StructContainerShape<NestedShapes>> {
    return serializeRefToJSON(
      this as any,
      Object.keys(this.structShape.shapes),
    ) as Infer<StructContainerShape<NestedShapes>>
  }

  // Deprecated methods - kept for backward compatibility
  // @deprecated Use property access: `obj.key.get()`
  get(key: string): any {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.get(key)
  }

  // @deprecated Use `.set()` on the property's PlainValueRef: `obj.key.set(value)`
  set(key: string, value: Value): void {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    container.set(key, value)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  // @deprecated Use loro(struct).setContainer() instead
  setContainer<C extends Container>(key: string, container: C): C {
    const loroContainer = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    const result = loroContainer.setContainer(key, container)
    this[INTERNAL_SYMBOL].commitIfAuto()
    return result
  }

  // @deprecated Struct properties cannot be deleted. Use `.set()` to set to null/undefined if the schema allows.
  delete(key: string): void {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    container.delete(key)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  // @deprecated Use property access to check: `obj.key.get() !== undefined`
  has(key: string): boolean {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.get(key) !== undefined
  }

  // @deprecated `Object.keys(obj)` works correctly
  keys(): string[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.keys()
  }

  // @deprecated `Object.values(obj)` returns PlainValueRefs; use `.get()` to unwrap
  values(): any[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.values()
  }

  // @deprecated Use `Object.keys(obj).length` instead
  get size(): number {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.size
  }
}

/**
 * Creates a StructRef wrapped in a Proxy for JavaScript-native object behavior.
 * Supports:
 * - Property access: obj.key (returns PlainValueRef or nested Ref)
 * - Object.keys(obj)
 * - 'key' in obj
 * - toJSON()
 * - loro(obj) for CRDT access
 *
 * Note: Property assignment is NOT supported. Use .set() on the PlainValueRef instead:
 *   doc.meta.title.set("New Title")  // Correct
 *   doc.meta.title = "New Title"     // NOT supported
 */
export function createStructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(
  params: TypedRefParams<StructContainerShape<NestedShapes>>,
): StructRef<NestedShapes> {
  const impl = new StructRefImpl<NestedShapes>(params)

  const proxy = new Proxy(impl, {
    get(target, prop, receiver) {
      // Handle Symbol access (loro(), ext(), internal, etc.)
      if (prop === LORO_SYMBOL) {
        return target[INTERNAL_SYMBOL].getContainer()
      }

      // Handle EXT_SYMBOL for ext() access - delegate to TypedRef base class
      if (prop === EXT_SYMBOL) {
        return target[INTERNAL_SYMBOL].getExtNamespace()
      }

      // Handle INTERNAL_SYMBOL for internal methods
      if (prop === INTERNAL_SYMBOL) {
        return target[INTERNAL_SYMBOL]
      }

      // Handle toJSON - use serializeRefToJSON with the proxy (receiver) so property access goes through the proxy
      if (prop === "toJSON") {
        return () =>
          serializeRefToJSON(receiver, Object.keys(target.structShape.shapes))
      }

      // Handle shape access (internal - needed for assignPlainValueToTypedRef)
      if (prop === "shape") {
        return target.structShape
      }

      // Schema property access
      if (typeof prop === "string" && prop in target.structShape.shapes) {
        const shape = target.structShape.shapes[prop]
        return target[INTERNAL_SYMBOL].getOrCreateRef(prop, shape)
      }

      return undefined
    },

    has(target, prop) {
      if (
        prop === LORO_SYMBOL ||
        prop === EXT_SYMBOL ||
        prop === INTERNAL_SYMBOL ||
        prop === "toJSON" ||
        prop === "shape"
      ) {
        return true
      }
      if (typeof prop === "string") {
        return prop in target.structShape.shapes
      }
      return false
    },

    ownKeys(target) {
      // Return only schema keys, not internal methods
      return Object.keys(target.structShape.shapes)
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && prop in target.structShape.shapes) {
        const shape = target.structShape.shapes[prop]
        return {
          configurable: true,
          enumerable: true,
          value: target[INTERNAL_SYMBOL].getOrCreateRef(prop, shape),
        }
      }
      return undefined
    },
  }) as unknown as StructRef<NestedShapes>

  return proxy
}

/**
 * Typed ref for struct containers (objects with fixed keys).
 * Uses LoroMap as the underlying container.
 *
 * The `Mode` parameter exists for type-level compatibility but both modes
 * return `PlainValueRef<T>` for value shape properties. Use `.get()` to read
 * and `.set()` to write values.
 *
 * Supports JavaScript-native object behavior:
 * - Property access: obj.key (returns PlainValueRef or nested Ref)
 * - Object.keys(obj)
 * - 'key' in obj
 *
 * Note: Property assignment is NOT supported. Use `.set()` on the PlainValueRef:
 *   doc.settings.darkMode.set(true)   // Correct
 *   doc.settings.darkMode = true      // NOT supported
 *
 * @example
 * ```typescript
 * const schema = Shape.doc({
 *   settings: Shape.struct({
 *     darkMode: Shape.plain.boolean().placeholder(false),
 *     fontSize: Shape.plain.number().placeholder(14),
 *   }),
 * });
 *
 * const doc = createTypedDoc(schema);
 *
 * // Reading values
 * const isDark = doc.settings.darkMode.get();
 *
 * // Writing values
 * doc.settings.darkMode.set(true);
 * doc.settings.fontSize.set(16);
 *
 * // Inside change() - same API
 * change(doc, draft => {
 *   draft.settings.darkMode.set(false);
 * });
 *
 * // Object.keys()
 * console.log(Object.keys(doc.settings)); // ['darkMode', 'fontSize']
 *
 * // 'key' in obj
 * console.log('darkMode' in doc.settings); // true
 *
 * // CRDT access via loro()
 * import { loro } from "@loro-extended/change";
 * loro(doc.settings).setContainer('nested', loroMap);
 * loro(doc.settings).subscribe(callback);
 * ```
 */
export type StructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
  Mode extends RefMode = "mutable",
> = {
  [K in keyof NestedShapes]: SelectByMode<NestedShapes[K], Mode>
} & {
  /**
   * Serializes the struct to a plain JSON-compatible object.
   */
  toJSON(): Infer<StructContainerShape<NestedShapes>>

  /**
   * Internal methods accessed via INTERNAL_SYMBOL.
   * @internal
   */
  [INTERNAL_SYMBOL]: RefInternalsBase

  /**
   * Access CRDT internals via the well-known symbol.
   * Used by the loro() function - returns LoroMap directly.
   */
  [LORO_SYMBOL]: LoroMap
}

// Re-export for backward compatibility
// The old class-based StructRef is now replaced by the proxy-based version
export { StructRefImpl as StructRefClass }
