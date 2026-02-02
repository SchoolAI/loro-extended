import {
  createHooks,
  createRefHooks,
  createTextHooks,
  createUndoHooks,
} from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

export const {
  RepoContext,
  useRepo,
  useHandle,
  useDoc,
  useLens,
  useEphemeral,
} = createHooks(Hono)

export const { useCollaborativeText } = createTextHooks(Hono)
export const { useUndoManager } = createUndoHooks(Hono)
export const { useRefValue } = createRefHooks(Hono)
