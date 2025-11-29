import {
  type ContainerShape,
  type InferPlainType,
  mergeValue,
  type ValueShape,
} from "@loro-extended/change"
import type { DocHandle } from "./doc-handle.js"

export class TypedPresence<S extends ContainerShape | ValueShape> {
  constructor(
    public shape: S,
    public emptyState: InferPlainType<S>,
    private handle: DocHandle,
  ) {}

  get self(): InferPlainType<S> {
    return mergeValue(
      this.shape,
      this.handle.untypedPresence.self,
      this.emptyState,
    ) as InferPlainType<S>
  }

  get all(): Record<string, InferPlainType<S>> {
    const result: Record<string, InferPlainType<S>> = {}
    const all = this.handle.untypedPresence.all
    for (const peerId of Object.keys(all)) {
      result[peerId] = mergeValue(
        this.shape,
        all[peerId],
        this.emptyState,
      ) as InferPlainType<S>
    }
    return result
  }

  set(value: Partial<InferPlainType<S>>) {
    this.handle.untypedPresence.set(value as any)
  }

  subscribe(
    cb: (state: {
      self: InferPlainType<S>
      all: Record<string, InferPlainType<S>>
    }) => void,
  ): () => void {
    // Initial call
    cb({ self: this.self, all: this.all })

    return this.handle.untypedPresence.subscribe(() => {
      cb({ self: this.self, all: this.all })
    })
  }
}
