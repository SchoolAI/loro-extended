import { createHooks } from "@loro-extended/hooks-core"
import * as React from "react"

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
} = createHooks(React)
