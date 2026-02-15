import type { DocShape, TypedDoc } from "@loro-extended/change"
import type { AnyTypedRef } from "@loro-extended/hooks-core"
import {
  createHooks,
  createRefHooks,
  createTextHooks,
  createUndoHooks,
} from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

const coreHooks = createHooks(Hono)
const refHooks = createRefHooks(Hono)

export const { RepoContext, useRepo, useDocument, useEphemeral, useLens } =
  coreHooks

// ============================================================================
// useValue - Explicit overloads to preserve type inference across packages
// ============================================================================

/**
 * Subscribe to a ref's or doc's value reactively.
 * Returns the value directly (not wrapped in an object).
 *
 * @param ref - A typed ref (TextRef, ListRef, etc.)
 * @returns The current value from toJSON()
 */
export function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>

/**
 * Subscribe to a doc's value reactively.
 * Returns the full document snapshot.
 *
 * @param doc - A TypedDoc or Doc from useDocument
 * @returns The current document snapshot
 */
export function useValue<T extends TypedDoc<DocShape>>(
  doc: T,
): ReturnType<T["toJSON"]>

// Implementation delegates to the factory-created hook
export function useValue(refOrDoc: AnyTypedRef | TypedDoc<DocShape>): unknown {
  return refHooks.useValue(refOrDoc as any)
}

// ============================================================================
// usePlaceholder - Explicit overload to preserve type inference
// ============================================================================

/**
 * Get the placeholder value for a ref.
 *
 * @param ref - A typed ref (TextRef, ListRef, etc.)
 * @returns The placeholder value, or undefined if not set
 */
export function usePlaceholder<R extends AnyTypedRef>(
  ref: R,
): ReturnType<R["toJSON"]> | undefined {
  return refHooks.usePlaceholder(ref)
}

export const { useCollaborativeText } = createTextHooks(Hono)
export const { useUndoManager } = createUndoHooks(Hono)
