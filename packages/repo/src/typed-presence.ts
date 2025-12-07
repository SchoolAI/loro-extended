import {
  type ContainerShape,
  type Infer,
  mergeValue,
  type ValueShape,
} from "@loro-extended/change"
import type { DocHandle } from "./doc-handle.js"

export class TypedPresence<S extends ContainerShape | ValueShape> {
  constructor(
    public shape: S,
    public emptyState: Infer<S>,
    private handle: DocHandle,
  ) {}

  get self(): Infer<S> {
    return mergeValue(
      this.shape,
      this.handle.untypedPresence.self,
      this.emptyState,
    ) as Infer<S>
  }

  get all(): Record<string, Infer<S>> {
    const result: Record<string, Infer<S>> = {}
    const all = this.handle.untypedPresence.all
    for (const peerId of Object.keys(all)) {
      result[peerId] = mergeValue(
        this.shape,
        all[peerId],
        this.emptyState,
      ) as Infer<S>
    }
    return result
  }

  set(value: Partial<Infer<S>>) {
    this.handle.untypedPresence.set(value as any)
  }

  subscribe(
    cb: (state: { self: Infer<S>; all: Record<string, Infer<S>> }) => void,
  ): () => void {
    // Initial call
    cb({ self: this.self, all: this.all })

    return this.handle.untypedPresence.subscribe(() => {
      cb({ self: this.self, all: this.all })
    })
  }
}
