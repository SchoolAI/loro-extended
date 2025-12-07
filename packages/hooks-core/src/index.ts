import type {
  ContainerShape,
  DeepReadonly,
  DocShape,
  Draft,
  Infer,
  ValueShape,
} from "@loro-extended/change"
import {
  derivePlaceholder,
  deriveShapePlaceholder,
  TypedDoc,
} from "@loro-extended/change"
import type { DocHandle, DocId, Repo } from "@loro-extended/repo"
import type { LoroDoc, LoroMap, Value } from "loro-crdt"

// Define the shape of the React/Hono library object we need
export interface FrameworkHooks {
  useState: <T>(
    initialState: T | (() => T),
  ) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  useCallback: <T extends Function>(callback: T, deps: unknown[]) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T | null }
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot,
  ) => Snapshot
  useContext: <T>(context: any) => T
  createContext: <T>(defaultValue: T) => any
}

export type DocWrapper = {
  doc: LoroMap<Record<string, unknown>>
}

/** A function that mutates a raw LoroDoc directly. */
export type SimpleChangeFn = (doc: LoroDoc) => void

/** A function that transforms a LoroDoc before applying changes. */
export type DocTransformer<TInput> = (doc: LoroDoc) => TInput

/** A function that mutates a Loro document using schema-aware drafts. */
export type ChangeFn<T extends DocShape> = (draft: Draft<T>) => void

export function createHooks(framework: FrameworkHooks) {
  const {
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    useSyncExternalStore,
    useContext,
    createContext,
  } = framework

  // --- RepoContext ---

  const RepoContext = createContext<Repo | null>(null)

  const useRepo = () => {
    const repo = useContext(RepoContext)
    if (!repo) {
      throw new Error("useRepo must be used within a RepoProvider")
    }
    return repo as Repo
  }

  // Note: RepoProvider component is not exported here because JSX types differ.
  // The consumer should implement RepoProvider using the exported RepoContext.

  // --- useDocHandleState ---

  function useDocHandleState(documentId: DocId) {
    const repo = useRepo()
    const [handle, setHandle] = useState<DocHandle<DocWrapper> | null>(null)

    // Handle lifecycle management
    useEffect(() => {
      const newHandle = repo.get<DocWrapper>(documentId)
      setHandle(newHandle)
    }, [repo, documentId])

    // Event subscription management
    const subscribe = useCallback(
      (onStoreChange: () => void) => {
        if (!handle) return () => {}

        const unsubscribe = handle.doc.subscribe(() => {
          onStoreChange()
        })

        return unsubscribe
      },
      [handle],
    )

    // State synchronization with stable snapshots
    const snapshotRef = useRef<{
      version: number
    }>({
      version: -1,
    })

    const getSnapshot = useCallback(() => {
      if (handle) {
        const version = handle.doc.opCount()

        if (snapshotRef.current && snapshotRef.current.version !== version) {
          snapshotRef.current = { version }
        }
      }

      if (!snapshotRef.current) {
        throw new Error("snapshotRef is not initialized")
      }

      return snapshotRef.current
    }, [handle])

    const snapshot = useSyncExternalStore(subscribe, getSnapshot)

    return { handle, snapshot }
  }

  // --- useDocChanger ---

  function useDocChanger<TInput = LoroDoc>(
    handle: DocHandle<DocWrapper> | null,
    transformer?: DocTransformer<TInput>,
  ) {
    return useCallback(
      (fn: (input: TInput) => void) => {
        if (!handle) {
          console.warn("doc handle not available for change")
          return
        }

        handle.change(loroDoc => {
          const input = transformer
            ? transformer(loroDoc as LoroDoc)
            : (loroDoc as TInput)
          fn(input)
        })
      },
      [handle, transformer],
    )
  }

  function useUntypedDocChanger(handle: DocHandle<DocWrapper> | null) {
    return useDocChanger<LoroDoc>(handle)
  }

  // --- useTypedDocState ---

  function useTypedDocState<T extends DocShape, Result = Infer<T>>(
    documentId: DocId,
    schema: T,
    selector?: (doc: DeepReadonly<Infer<T>>) => Result,
  ) {
    const { handle, snapshot } = useDocHandleState(documentId)

    const placeholder = useMemo(() => derivePlaceholder(schema), [schema])

    const doc: Result = useMemo(() => {
      if (!handle) {
        const state = placeholder as unknown as DeepReadonly<Infer<T>>
        return selector ? selector(state) : (state as unknown as Result)
      }

      const loroDoc = handle.doc
      const updatedTypedDoc = new TypedDoc(schema, loroDoc)

      void snapshot.version

      const value = updatedTypedDoc.value
      return selector ? selector(value) : (value as unknown as Result)
    }, [snapshot.version, handle, schema, placeholder, selector])

    return { doc, handle, snapshot }
  }

  // --- useTypedDocChanger ---

  function useTypedDocChanger<T extends DocShape>(
    handle: DocHandle<DocWrapper> | null,
    schema: T,
  ) {
    const transformer = useCallback(
      (loroDoc: LoroDoc) => {
        const typedDoc = new TypedDoc(schema, loroDoc)
        return typedDoc
      },
      [schema],
    )

    const baseChanger = useDocChanger(handle, transformer)

    return useCallback(
      (fn: ChangeFn<T>) => {
        baseChanger(typedDoc => {
          typedDoc.change(fn)
        })
      },
      [baseChanger],
    )
  }

  // --- useDocument ---

  function useDocument<T extends DocShape, Result = Infer<T>>(
    documentId: DocId,
    schema: T,
    selector?: (doc: DeepReadonly<Infer<T>>) => Result,
  ) {
    const { doc, handle } = useTypedDocState<T, Result>(
      documentId,
      schema,
      selector,
    )
    const changeDoc = useTypedDocChanger<T>(handle, schema)

    return [doc, changeDoc, handle] as const
  }

  function useRawLoroDoc(documentId: DocId) {
    const { handle, snapshot } = useDocHandleState(documentId)
    const doc = handle ? (handle.doc as LoroDoc) : null
    return { doc, handle, snapshot }
  }

  // --- useUntypedDocument ---

  function useUntypedDocument(documentId: DocId) {
    const { doc, handle } = useRawLoroDoc(documentId)
    const changeDoc = useUntypedDocChanger(handle)

    return [doc, changeDoc, handle] as const
  }

  // --- usePresence ---

  type PresenceContext<T> = {
    self: T
    all: Record<string, T>
    setSelf: (value: Partial<T>) => void
  }

  type ObjectValue = {
    [key: string]: Value
  }

  function useUntypedPresence<T extends ObjectValue = ObjectValue, R = any>(
    docId: DocId,
    selector?: (state: PresenceContext<T>) => R,
  ) {
    const { handle } = useDocHandleState(docId)

    const store = useMemo(() => {
      if (!handle) {
        const empty = {
          self: {} as T,
          all: {},
          setSelf: (_: any) => {},
        }
        return {
          subscribe: () => () => {},
          getSnapshot: () => empty,
        }
      }

      const setSelf = (values: Partial<T>) => {
        handle.untypedPresence.set(values)
      }

      const computeState = () => {
        const all = handle.untypedPresence.all as Record<string, T>
        const self = handle.untypedPresence.self as T

        return { self, all, setSelf }
      }

      let cachedState = computeState()

      const subscribe = (callback: () => void) => {
        return handle.untypedPresence.subscribe(() => {
          cachedState = computeState()
          callback()
        })
      }

      const getSnapshot = () => cachedState

      return { subscribe, getSnapshot }
    }, [handle])

    const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

    if (selector) {
      return selector(state as PresenceContext<T>)
    }

    return state as PresenceContext<T>
  }

  function usePresence<S extends ContainerShape | ValueShape, R = any>(
    docId: DocId,
    shape: S,
    selector?: (state: PresenceContext<Infer<S>>) => R,
  ) {
    const { handle } = useDocHandleState(docId)

    // Derive placeholder from schema
    const placeholder = useMemo(
      () => deriveShapePlaceholder(shape) as Infer<S>,
      [shape],
    )

    const store = useMemo(() => {
      if (!handle) {
        const empty = {
          self: placeholder,
          all: {},
          setSelf: (_: any) => {},
        }
        return {
          subscribe: () => () => {},
          getSnapshot: () => empty,
        }
      }

      const typedPresence = handle.presence(shape)
      const setSelf = (values: Partial<Infer<S>>) => {
        typedPresence.set(values)
      }

      const computeState = () => {
        return {
          self: typedPresence.self,
          all: typedPresence.all,
          setSelf,
        }
      }

      let cachedState = computeState()

      const subscribe = (callback: () => void) => {
        return typedPresence.subscribe(() => {
          cachedState = computeState()
          callback()
        })
      }

      const getSnapshot = () => cachedState
      return { subscribe, getSnapshot }
    }, [handle, shape, placeholder])

    const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

    if (selector) {
      return selector(state as PresenceContext<Infer<S>>)
    }

    return state as PresenceContext<Infer<S>>
  }

  return {
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
  }
}
