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

export const { useValue, usePlaceholder } = refHooks

export const { useCollaborativeText } = createTextHooks(Hono)
export const { useUndoManager } = createUndoHooks(Hono)
