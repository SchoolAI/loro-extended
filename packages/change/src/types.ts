/* =============================================================================
 * UNIFIED BASE SCHEMA MAPPER SYSTEM
 * =============================================================================
 */

import type { CounterDraftNode } from "./draft-nodes/counter.js"
import type { ListDraftNode } from "./draft-nodes/list.js"
import type { MapDraftNode } from "./draft-nodes/map.js"
import type { MovableListDraftNode } from "./draft-nodes/movable-list.js"
import type { TextDraftNode } from "./draft-nodes/text.js"
import type {
  ArrayValueShape,
  BooleanValueShape,
  ContainerShape,
  CounterContainerShape,
  DocShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  NullValueShape,
  NumberValueShape,
  ObjectValueShape,
  StringValueShape,
  TextContainerShape,
  Uint8ArrayValueShape,
  UndefinedValueShape,
  UnionValueShape,
  ValueShape,
} from "./shape.js"

// Context types for different mapping scenarios
type PlainTypeContext = "plain" // Maps to input parameter types
type DraftTypeContext = "draft" // Maps to draft-aware types

type MappingContext = PlainTypeContext | DraftTypeContext

// Unified base mapper that handles all schema type matching
// biome-ignore format: visual
type BaseSchemaMapper<T, Context extends MappingContext> =
  // LoroDoc is at the root
  T extends DocShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? object
      : never
  // Loro container types
  : T extends TextContainerShape
    ? Context extends "plain" ? string
      : Context extends "draft" ? TextDraftNode
      : never
  : T extends CounterContainerShape
    ? Context extends "plain" ? number
      : Context extends "draft" ? CounterDraftNode
      : never
  : T extends ListContainerShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? ListDraftNode<T>
      : never
  : T extends MovableListContainerShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? MovableListDraftNode<T>
      : never
  : T extends MapContainerShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? MapDraftNode<T> & { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
      : never
  // : T extends TreeContainerShape<infer U>
  //   ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
  //     : Context extends "draft" ? DraftLoroTree<U>
  //     : never
  // Values
  : T extends StringValueShape
    ? Context extends "plain" ? string
      : Context extends "draft" ? string
      : never
  : T extends NumberValueShape
    ? Context extends "plain" ? number
      : Context extends "draft" ? number
      : never
  : T extends BooleanValueShape
    ? Context extends "plain" ? boolean
      : Context extends "draft" ? boolean
      : never
  : T extends NullValueShape
    ? Context extends "plain" ? null
      : Context extends "draft" ? null
      : never
  : T extends UndefinedValueShape
    ? Context extends "plain" ? undefined
      : Context extends "draft" ? undefined
      : never
  : T extends Uint8ArrayValueShape
    ? Context extends "plain" ? Uint8Array
      : Context extends "draft" ? Uint8Array
      : never
  : T extends ObjectValueShape<infer U>
    ? Context extends "plain" ? { [K in keyof U]: BaseSchemaMapper<U[K], "plain"> }
      : Context extends "draft" ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
      : never
  : T extends ArrayValueShape<infer U>
    ? Context extends "plain" ? BaseSchemaMapper<U, "plain">[]
      : Context extends "draft" ? BaseSchemaMapper<U, "draft">[]
      : never
  : T extends UnionValueShape<infer U>
    ? U extends readonly ValueShape[]
      ? Context extends "plain" ? BaseSchemaMapper<U, "plain">
        : Context extends "draft" ? BaseSchemaMapper<U, "draft">
        : never
      : never
  // biome-ignore lint/suspicious/noExplicitAny: required for type system to work
  : any

// Input type inference - what developers can pass to push/insert methods
export type InferPlainType<T> = BaseSchemaMapper<T, "plain">

export type InferDraftType<T> = BaseSchemaMapper<T, "draft">

// Draft-specific type inference that properly handles the draft context
export type Draft<T extends DocShape<Record<string, ContainerShape>>> =
  T extends DocShape<infer U>
    ? { [K in keyof U]: BaseSchemaMapper<U[K], "draft"> }
    : never
