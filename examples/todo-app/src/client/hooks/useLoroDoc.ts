import { useSyncExternalStore, useCallback, useMemo } from "react";
import {
  type AsLoro,
  type DocHandle,
  type HandleState,
} from "@loro-extended/repo";

/** A function that mutates a Loro document. */
export type ChangeFn<T> = (doc: AsLoro<T>) => void;

/** The return type of the `useLoroDoc` hook. */
export type UseLoroDocReturn<T> = [
  /** The current state of the document, or undefined if not ready. */
  doc: T | undefined,
  /** A function to change the document. */
  changeFn: (fn: ChangeFn<T>) => void,
  /** The current state of the DocHandle. */
  state: HandleState,
];

/**
 * A hook that provides a reactive interface to a Loro document handle.
 *
 * It returns a tuple containing the document's data, a function to
 * modify it, and the current state of the handle (e.g., 'loading', 'ready').
 *
 * @example
 * ```tsx
 * const [doc, changeDoc, state] = useLoroDoc(handle)
 *
 * if (state !== 'ready') {
 *   return <Loading />
 * }
 *
 * return (
 *  <div>
 *    <p>{doc.title}</p>
 *    <button onClick={() => changeDoc(d => d.title = "New Title")}>
 *      Change Title
 *    </button>
 *  </div>
 * )
 * ```
 */
export function useLoroDoc<T extends Record<string, any>>(
  handle: DocHandle<T>,
): UseLoroDocReturn<T> {
  const subscribe = useCallback((onStoreChange: () => void) => {
    handle.on("doc-handle-change", onStoreChange);
    handle.on("doc-handle-state-transition", onStoreChange);
    return () => {
      handle.off("doc-handle-change", onStoreChange);
      handle.off("doc-handle-state-transition", onStoreChange);
    };
  }, [handle]);
  
  const getSnapshot = useMemo(() => {
    let lastSnapshot: { version: string | null; state: HandleState } | null = null;
    
    return () => {
      const currentState = handle.state;
      let currentVersion: string | null = null;
      if (currentState === "ready") {
        const vv = handle.doc()?.oplogVersion();
        currentVersion = vv ? JSON.stringify(Object.fromEntries(vv.toJSON())) : null;
      }
      
      if (lastSnapshot && lastSnapshot.state === currentState && lastSnapshot.version === currentVersion) {
         return lastSnapshot;
      }

      lastSnapshot = { version: currentVersion, state: currentState };
      return lastSnapshot;
    }
  }, [handle]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const doc = useMemo(() => {
    if (snapshot.state !== "ready" || snapshot.version === null) {
      return undefined;
    }
    return handle.doc()?.toJSON();
  }, [snapshot, handle]);


  const changeDoc = useCallback(
    (fn: ChangeFn<T>) => {
      handle.change(fn);
    },
    [handle],
  );

  return [doc as T | undefined, changeDoc, snapshot.state];
}