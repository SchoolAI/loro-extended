import type { Container, LoroMap, Value } from "loro-crdt"
import { mergeValue } from "../overlay.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  StructContainerShape,
  ValueShape,
} from "../shape.js"
import type { Infer } from "../types.js"
import { isContainerShape, isValueShape } from "../utils/type-guards.js"
import { TypedRef, type TypedRefParams } from "./base.js"
import {
  absorbCachedPlainValues,
  assignPlainValueToTypedRef,
  containerConstructor,
  createContainerTypedRef,
  hasContainerConstructor,
  serializeRefToJSON,
  unwrapReadonlyPrimitive,
} from "./utils.js"

/**
 * Typed ref for struct containers (objects with fixed keys).
 * Uses LoroMap as the underlying container.
 */
export class StructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
> extends TypedRef<any> {
  private propertyCache = new Map<string, TypedRef<ContainerShape> | Value>()

  constructor(params: TypedRefParams<StructContainerShape<NestedShapes>>) {
    super(params)
    this.createLazyProperties()
  }

  protected get shape(): StructContainerShape<NestedShapes> {
    return super.shape as StructContainerShape<NestedShapes>
  }

  protected get container(): LoroMap {
    return super.container as LoroMap
  }

  absorbPlainValues() {
    absorbCachedPlainValues(this.propertyCache, () => this.container)
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
        this.container.getOrCreateContainer(key, new (LoroContainer as any)()),
      readonly: this.readonly,
      autoCommit: this._params.autoCommit,
      getDoc: this._params.getDoc,
    }
  }

  getOrCreateRef<Shape extends ContainerShape | ValueShape>(
    key: string,
    shape: Shape,
  ): any {
    let ref = this.propertyCache.get(key)
    if (!ref) {
      if (isContainerShape(shape)) {
        ref = createContainerTypedRef(this.getTypedRefParams(key, shape))
        // We cache container refs even in readonly mode because they are just handles
        this.propertyCache.set(key, ref)
      } else {
        // For value shapes, first try to get the value from the container
        const containerValue = this.container.get(key)
        if (containerValue !== undefined) {
          ref = containerValue as Value
        } else {
          // Only fall back to placeholder if the container doesn't have the value
          const placeholder = (this.placeholder as any)?.[key]
          if (placeholder === undefined) {
            throw new Error("placeholder required")
          }
          ref = placeholder as Value
        }

        // In readonly mode, we DO NOT cache primitive values.
        // This ensures we always get the latest value from the CRDT on next access.
        if (!this.readonly) {
          this.propertyCache.set(key, ref)
        }
      }
      if (ref === undefined) throw new Error("no container made")
    }

    if (this.readonly && isContainerShape(shape)) {
      // In readonly mode, if the container doesn't exist, return the placeholder
      // This ensures we respect default values (e.g. counter: 1)
      const existing = this.container.get(key)
      if (existing === undefined) {
        return (this.placeholder as any)?.[key]
      }

      return unwrapReadonlyPrimitive(ref as TypedRef<any>, shape)
    }

    return ref as Shape extends ContainerShape ? TypedRef<Shape> : Value
  }

  private createLazyProperties(): void {
    for (const key in this.shape.shapes) {
      const shape = this.shape.shapes[key]
      Object.defineProperty(this, key, {
        get: () => this.getOrCreateRef(key, shape),
        set: value => {
          this.assertMutable()
          if (isValueShape(shape)) {
            this.container.set(key, value)
            this.propertyCache.set(key, value)
          } else {
            // For container shapes, try to assign the plain value
            const ref = this.getOrCreateRef(key, shape)
            if (assignPlainValueToTypedRef(ref as TypedRef<any>, value)) {
              return
            }
            throw new Error(
              "Cannot set container directly, modify the typed ref instead",
            )
          }
        },
        enumerable: true,
      })
    }
  }

  toJSON(): Infer<StructContainerShape<NestedShapes>> {
    // Fast path: readonly mode
    if (this.readonly) {
      const nativeJson = this.container.toJSON() as Value
      // Overlay placeholders for missing properties
      return mergeValue(
        this.shape,
        nativeJson,
        this.placeholder as Value,
      ) as Infer<StructContainerShape<NestedShapes>>
    }

    return serializeRefToJSON(
      this as any,
      Object.keys(this.shape.shapes),
    ) as Infer<StructContainerShape<NestedShapes>>
  }

  // TODO(duane): return correct type here
  get(key: string): any {
    return this.container.get(key)
  }

  set(key: string, value: Value): void {
    this.assertMutable()
    this.container.set(key, value)
    this.commitIfAuto()
  }

  setContainer<C extends Container>(key: string, container: C): C {
    this.assertMutable()
    const result = this.container.setContainer(key, container)
    this.commitIfAuto()
    return result
  }

  delete(key: string): void {
    this.assertMutable()
    this.container.delete(key)
    this.commitIfAuto()
  }

  has(key: string): boolean {
    // LoroMap doesn't have a has method, so we check if get returns undefined
    return this.container.get(key) !== undefined
  }

  keys(): string[] {
    return this.container.keys()
  }

  values(): any[] {
    return this.container.values()
  }

  get size(): number {
    return this.container.size
  }
}
