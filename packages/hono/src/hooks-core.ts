import {
  createHooks,
  createTextHooks,
  createUndoHooks,
} from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } =
  createHooks(Hono)

export const { useCollaborativeText } = createTextHooks(Hono)
export const { useUndoManager } = createUndoHooks(Hono)
