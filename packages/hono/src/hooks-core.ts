import { createHooks } from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

export const { RepoContext, useRepo, useHandle, useDoc, usePresence } =
  createHooks(Hono)
