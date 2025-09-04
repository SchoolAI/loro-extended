export { useDocument } from "./hooks/use-document.js"
export type { UseDocumentReturn } from "./hooks/use-document.js"
export type { ChangeFn } from "./hooks/use-loro-doc-changer.js"
export type { DocWrapper } from "./hooks/use-loro-doc-state.js"

// Re-export schema-related types from @loro-extended/change for convenience
export type {
  LoroDocSchema,
  InferDraftType,
  InferEmptyType,
  LoroShape
} from "@loro-extended/change"

export * from "./repo-context.js"
