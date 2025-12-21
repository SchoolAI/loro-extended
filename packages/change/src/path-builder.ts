// ============================================================================
// Path Builder Factory
// ============================================================================
//
// Runtime implementation of the path builder that creates PathSelector objects
// with proper segments for JSONPath compilation.

import type { PathBuilder, PathSegment, PathSelector } from "./path-selector.js"
import type { ContainerOrValueShape, DocShape } from "./shape.js"

function createPathSelector<T>(segments: PathSegment[]): PathSelector<T> {
  return {
    __resultType: undefined as unknown as T,
    __segments: segments,
  }
}

function createPathNode(
  shape: ContainerOrValueShape,
  segments: PathSegment[],
): unknown {
  const selector = createPathSelector(segments)

  // Terminal shapes (text, counter, value)
  if (shape._type === "text" || shape._type === "counter") {
    return selector
  }
  if (shape._type === "value") {
    return selector
  }

  // List/MovableList
  if (shape._type === "list" || shape._type === "movableList") {
    return Object.assign(selector, {
      get $each() {
        return createPathNode(shape.shape, [...segments, { type: "each" }])
      },
      $at(index: number) {
        return createPathNode(shape.shape, [
          ...segments,
          { type: "index", index },
        ])
      },
      get $first() {
        return createPathNode(shape.shape, [
          ...segments,
          { type: "index", index: 0 },
        ])
      },
      get $last() {
        return createPathNode(shape.shape, [
          ...segments,
          { type: "index", index: -1 },
        ])
      },
    })
  }

  // Struct (fixed keys)
  if (shape._type === "struct") {
    const props: Record<string, unknown> = {}
    for (const key in shape.shapes) {
      Object.defineProperty(props, key, {
        get() {
          return createPathNode(shape.shapes[key], [
            ...segments,
            { type: "property", key },
          ])
        },
        enumerable: true,
      })
    }
    return Object.assign(selector, props)
  }

  // Record (dynamic keys)
  if (shape._type === "record") {
    return Object.assign(selector, {
      get $each() {
        return createPathNode(shape.shape, [...segments, { type: "each" }])
      },
      $key(key: string) {
        return createPathNode(shape.shape, [...segments, { type: "key", key }])
      },
    })
  }

  return selector
}

/**
 * Creates a path builder for a given document shape.
 *
 * The path builder provides a type-safe DSL for selecting paths within
 * a document. The resulting PathSelector can be compiled to a JSONPath
 * string for use with subscribeJsonpath.
 *
 * @example
 * ```typescript
 * const docShape = Shape.doc({
 *   books: Shape.list(Shape.struct({
 *     title: Shape.text(),
 *     price: Shape.plain.number(),
 *   })),
 * })
 *
 * const builder = createPathBuilder(docShape)
 * const selector = builder.books.$each.title
 * // selector.__segments = [
 * //   { type: "property", key: "books" },
 * //   { type: "each" },
 * //   { type: "property", key: "title" }
 * // ]
 * ```
 */
export function createPathBuilder<D extends DocShape>(
  docShape: D,
): PathBuilder<D> {
  const builder: Record<string, unknown> = {}

  for (const key in docShape.shapes) {
    Object.defineProperty(builder, key, {
      get() {
        return createPathNode(docShape.shapes[key], [{ type: "property", key }])
      },
      enumerable: true,
    })
  }

  return builder as PathBuilder<D>
}
