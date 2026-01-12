import type { Container, LoroMap, Value } from "loro-crdt"
import { LORO_SYMBOL, type LoroMapRef } from "../loro.js"
import type { ContainerOrValueShape, StructContainerShape } from "../shape.js"
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
  // @deprecated Use property access instead: obj.key
  get(key: string): any {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.get(key)
  }

  // @deprecated Use property assignment instead: obj.key = value
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

  // @deprecated Use delete obj.key instead
  delete(key: string): void {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    container.delete(key)
    this[INTERNAL_SYMBOL].commitIfAuto()
  }

  // @deprecated Use 'key' in obj instead
  has(key: string): boolean {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.get(key) !== undefined
  }

  // @deprecated Use Object.keys(obj) instead
  keys(): string[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.keys()
  }

  // @deprecated Use Object.values(obj) instead
  values(): any[] {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.values()
  }

  // @deprecated Not standard for objects
  get size(): number {
    const container = this[INTERNAL_SYMBOL].getContainer() as LoroMap
    return container.size
  }
}

/**
 * Creates a StructRef wrapped in a Proxy for JavaScript-native object behavior.
 * Supports:
 * - Property access: obj.key
 * - Property assignment: obj.key = value
 * - Object.keys(obj)
 * - 'key' in obj
 * - delete obj.key
 * - toJSON()
 * - loro(obj) for CRDT access
 */
export function createStructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
>(
  params: TypedRefParams<StructContainerShape<NestedShapes>>,
): StructRef<NestedShapes> {
  const impl = new StructRefImpl<NestedShapes>(params)

  const proxy = new Proxy(impl, {
    get(target, prop, receiver) {
      // Handle Symbol access (loro(), internal, etc.)
      if (prop === LORO_SYMBOL) {
        return target[INTERNAL_SYMBOL].getLoroNamespace()
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

    set(target, prop, value) {
      if (typeof prop === "string" && prop in target.structShape.shapes) {
        target[INTERNAL_SYMBOL].setPropertyValue(prop, value)
        return true
      }
      return false
    },

    has(target, prop) {
      if (
        prop === LORO_SYMBOL ||
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

    deleteProperty(target, prop) {
      if (typeof prop === "string" && prop in target.structShape.shapes) {
        target[INTERNAL_SYMBOL].deleteProperty(prop)
        return true
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
 * Supports JavaScript-native object behavior:
 * - Property access: obj.key
 * - Property assignment: obj.key = value
 * - Object.keys(obj)
 * - 'key' in obj
 * - delete obj.key
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
 * // Property access
 * doc.settings.darkMode = true;
 * console.log(doc.settings.darkMode); // true
 *
 * // Object.keys()
 * console.log(Object.keys(doc.settings)); // ['darkMode', 'fontSize']
 *
 * // 'key' in obj
 * console.log('darkMode' in doc.settings); // true
 *
 * // delete obj.key
 * delete doc.settings.darkMode;
 *
 * // CRDT access via loro()
 * import { loro } from "@loro-extended/change";
 * loro(doc.settings).setContainer('nested', loroMap);
 * loro(doc.settings).subscribe(callback);
 * ```
 */
export type StructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> = {
  [K in keyof NestedShapes]: NestedShapes[K]["_mutable"]
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
   * Used by the loro() function.
   */
  [LORO_SYMBOL]: LoroMapRef
}

// Re-export for backward compatibility
// The old class-based StructRef is now replaced by the proxy-based version
export { StructRefImpl as StructRefClass }
