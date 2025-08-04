import { useSyncExternalStore, useCallback } from "react";
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
  const subscribe = (onStoreChange: () => void) => {
    // Subscribing to both 'change' and 'state-change' ensures the component
    // re-renders whenever the document data or the handle's state changes.
    handle.on("change", onStoreChange);
    handle.on("state-change", onStoreChange);
    return () => {
      handle.off("change", onStoreChange);
      handle.off("state-change", onStoreChange);
    };
  };

  // getSnapshot returns the data needed for the component to render.
  // We bundle the doc and state together so they are always consistent.
  const getSnapshot = () => ({
    doc: handle.state === "ready" ? handle.doc()?.toJSON() : undefined,
    state: handle.state,
  });

  const { doc, state } = useSyncExternalStore(subscribe, getSnapshot);

  const changeDoc = useCallback(
    (fn: ChangeFn<T>) => {
      handle.change(fn);
    },
    [handle],
  );

  return [doc as T | undefined, changeDoc, state];
}