import { createHooks } from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

export const {
  RepoContext,
  useRepo,
  useDocHandleState,
  useDocChanger,
  useUntypedDocChanger,
  useTypedDocState,
  useTypedDocChanger,
  useDocument,
  useRawLoroDoc,
  useUntypedDocument,
  useUntypedPresence,
  usePresence,
} = createHooks(Hono)
