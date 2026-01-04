import type {
  Container,
  LoroDoc,
  LoroMap,
  Subscription,
  Value,
} from "loro-crdt"
import { LORO_SYMBOL, type LoroMapRef, type LoroRefBase } from "../loro.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
  ValueShape,
} from "../shape.js"
import type { Infer } from "../types.js"
import { isValueShape } from "../utils/type-guards.js"
import {
  INTERNAL_SYMBOL,
  type RefInternals,
  TypedRef,
  type TypedRefParams,
} from "./base.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
  serializeRefToJSON,
} from "./utils.js"

/**
 * Internal implementation class for struct containers.
 * The actual StructRef is a Proxy wrapping this class.
 */
class StructRefImpl<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends TypedRef<any> {
  private propertyCache = new Map<string, TypedRef<ContainerShape> | Value>()
  private _structLoroNamespace?: LoroMapRef

  get structShape(): StructContainerShape<NestedShapes> {
    return super.shape as StructContainerShape<NestedShapes>
  }

  get loroMap(): LoroMap {
    return super.container as LoroMap
  }

  /**
   * Override to add struct-specific methods to the loro() namespace.
   */
  protected override createLoroNamespace(): LoroRefBase {
    if (this._structLoroNamespace) return this._structLoroNamespace
    const self = this
    this._structLoroNamespace = {
      get doc(): LoroDoc {
        return self._params.getDoc()
      },
      get container(): LoroMap {
        return self.loroMap
      },
      subscribe(callback: (event: unknown) => void): Subscription {
        return self.loroMap.subscribe(callback)
      },
      setContainer(key: string, container: Container): Container {
        const result = self.loroMap.setContainer(key, container)
        self.commitIfAuto()
        return result
      },
    }
    return this._structLoroNamespace
  }

  getLoroNamespace(): LoroMapRef {
    return this.createLoroNamespace() as LoroMapRef
  }

  // Implement the abstract INTERNAL_SYMBOL property
  [INTERNAL_SYMBOL]: RefInternals = {
    absorbPlainValues: () => {
      absorbCachedPlainValues(this.propertyCache, () => this.loroMap)
    },
  }

  getTypedRefParams<S extends ContainerShape>(
    key: string,
    shape: S,
  ): TypedRefParams<ContainerShape> {
    const placeholder = (this.placeholder as any)?.[key]

    // AnyContainerShape is an escape hatch - it doesn't have a constructor
    if (!hasContainerConstructor(shape._type)) {
      throw new Error(
        `Cannot create typed ref for shape type "${shape._type}". ` +
          `Use Shape.any() only at the document root level.`,
      )
    }

    const LoroContainer = containerConstructor[shape._type]

    return {
      shape,
      placeholder,
      getContainer: () =>
        this.loroMap.getOrCreateContainer(key, new (LoroContainer as any)()),
      autoCommit: this._params.autoCommit,
      batchedMutation: this.batchedMutation,
      getDoc: this._params.getDoc,
    }
  }

  getOrCreateRef<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape: Shape,
  ): any {
    if (isValueShape(shape)) {
      // When NOT in batchedMutation mode (direct access outside of change()), ALWAYS read fresh
      // from container (NEVER cache). This ensures we always get the latest value
      // from the CRDT, even when modified by a different ref instance (e.g., drafts from change())
      //
      // When in batchedMutation mode (inside change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      if (!this.batchedMutation) {
        const containerValue = this.loroMap.get(key)
        if (containerValue !== undefined) {
          return containerValue
        }
        // Only fall back to placeholder if the container doesn't have the value
        const placeholder = (this.placeholder as any)?.[key]
        if (placeholder === undefined) {
          throw new Error("placeholder required")
        }
        return placeholder
      }

      // In batched mode (within change()), we cache value shapes so that
      // mutations to nested objects persist back to the CRDT via absorbPlainValues()
      let ref = this.propertyCache.get(key)
      if (!ref) {
        const containerValue = this.loroMap.get(key)
        if (containerValue !== undefined) {
          // For objects, create a deep copy so mutations can be tracked
          if (typeof containerValue === "object" && containerValue !== null) {
            ref = JSON.parse(JSON.stringify(containerValue))
          } else {
            ref = containerValue as Value
          }
        } else {
          // Only fall back to placeholder if the container doesn't have the value
          const placeholder = (this.placeholder as any)?.[key]
          if (placeholder === undefined) {
            throw new Error("placeholder required")
          }
          ref = placeholder as Value
        }
        this.propertyCache.set(key, ref)
      }
      return ref
    }

    // Container shapes: safe to cache (handles)
    let ref = this.propertyCache.get(key)
    if (!ref) {
      ref = createContainerTypedRef(this.getTypedRefParams(key, shape))
      this.propertyCache.set(key, ref)
    }

    return ref as Shape extends ContainerShape ? TypedRef<Shape> : Value
  }

  setPropertyValue(key: string, value: any): void {
    const shape = this.structShape.shapes[key]
    if (!shape) {
      throw new Error(`Unknown property: ${key}`)
    }

    if (isValueShape(shape)) {
      this.loroMap.set(key, value)
      this.propertyCache.set(key, value)
      this.commitIfAuto()
    } else {
      // For container shapes, try to assign the plain value
      const ref = this.getOrCreateRef(key, shape)
      if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
        this.commitIfAuto()
        return
      }
      throw new Error(
        "Cannot set container directly, modify the typed ref instead",
      )
    }
  }

  deleteProperty(key: string): void {
    this.loroMap.delete(key)
    this.propertyCache.delete(key)
    this.commitIfAuto()
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
    return this.loroMap.get(key)
  }

  // @deprecated Use property assignment instead: obj.key = value
  set(key: string, value: Value): void {
    this.loroMap.set(key, value)
    this.commitIfAuto()
  }

  // @deprecated Use loro(struct).setContainer() instead
  setContainer<C extends Container>(key: string, container: C): C {
    const result = this.loroMap.setContainer(key, container)
    this.commitIfAuto()
    return result
  }

  // @deprecated Use delete obj.key instead
  delete(key: string): void {
    this.loroMap.delete(key)
    this.commitIfAuto()
  }

  // @deprecated Use 'key' in obj instead
  has(key: string): boolean {
    return this.loroMap.get(key) !== undefined
  }

  // @deprecated Use Object.keys(obj) instead
  keys(): string[] {
    return this.loroMap.keys()
  }

  // @deprecated Use Object.values(obj) instead
  values(): any[] {
    return this.loroMap.values()
  }

  // @deprecated Not standard for objects
  get size(): number {
    return this.loroMap.size
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
        return target.getLoroNamespace()
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
        return target.getOrCreateRef(prop, shape)
      }

      return undefined
    },

    set(target, prop, value) {
      if (typeof prop === "string" && prop in target.structShape.shapes) {
        target.setPropertyValue(prop, value)
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
        target.deleteProperty(prop)
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
          value: target.getOrCreateRef(prop, shape),
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
  [INTERNAL_SYMBOL]: RefInternals
}

// Re-export for backward compatibility
// The old class-based StructRef is now replaced by the proxy-based version
export { StructRefImpl as StructRefClass }
