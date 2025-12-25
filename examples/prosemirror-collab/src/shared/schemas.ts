/**
 * Shared schemas for the collaborative ProseMirror example.
 *
 * This file defines the document schema for loro-prosemirror integration.
 * The document uses Shape.any() because loro-prosemirror manages its own
 * internal structure - we just need to tell loro-extended that the "doc"
 * container exists.
 */

import { Shape } from "@loro-extended/repo"

/**
 * Document schema for ProseMirror integration.
 *
 * loro-prosemirror stores its content in a LoroMap at the "doc" key.
 * We use Shape.any() to opt out of typing for this container since
 * loro-prosemirror manages its internal structure.
 */
export const ProseMirrorDocSchema = Shape.doc({
  doc: Shape.any(),
})

/**
 * Type alias for the document schema.
 */
export type ProseMirrorDocShape = typeof ProseMirrorDocSchema
