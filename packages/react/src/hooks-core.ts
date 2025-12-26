import { createHooks } from "@loro-extended/hooks-core"
import * as React from "react"

export const {
  RepoContext,
  useRepo,
  useHandle,
  useDoc,
  usePresence,
  useEphemeral,
} = createHooks(React)
