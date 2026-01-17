import {
  createHooks,
  createTextHooks,
  createUndoHooks,
} from "@loro-extended/hooks-core"
import * as React from "react"

export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } =
  createHooks(React)

export const { useCollaborativeText } = createTextHooks(React)
export const { useUndoManager } = createUndoHooks(React)
