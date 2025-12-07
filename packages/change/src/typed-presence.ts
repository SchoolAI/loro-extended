import { deriveShapePlaceholder } from "./derive-placeholder.js"
import { mergeValue } from "./overlay.js"
import type { ObjectValue, PresenceInterface } from "./presence-interface.js"
import type { ContainerShape, ValueShape } from "./shape.js"
import type { Infer } from "./types.js"

/**
 * A strongly-typed wrapper around a PresenceInterface.
 * Provides type-safe access to presence data with automatic placeholder merging.
 *
 * @typeParam S - The shape of the presence data
 */
export class TypedPresence<S extends ContainerShape | ValueShape> {
  private placeholder: Infer<S>

  constructor(
    public shape: S,
    private presence: PresenceInterface,
  ) {
    this.placeholder = deriveShapePlaceholder(shape) as Infer<S>
  }

  /**
   * Get the current peer's presence state with placeholder values merged in.
   */
  get self(): Infer<S> {
    return mergeValue(
      this.shape,
      this.presence.self,
      this.placeholder,
    ) as Infer<S>
  }

  /**
   * Get all peers' presence states with placeholder values merged in.
   */
  get all(): Record<string, Infer<S>> {
    const result: Record<string, Infer<S>> = {}
    const all = this.presence.all
    for (const peerId of Object.keys(all)) {
      result[peerId] = mergeValue(
        this.shape,
        all[peerId],
        this.placeholder,
      ) as Infer<S>
    }
    return result
  }

  /**
   * Set presence values for the current peer.
   */
  set(value: Partial<Infer<S>>) {
    this.presence.set(value as ObjectValue)
  }

  /**
   * Subscribe to presence changes.
   * The callback is called immediately with the current state, then on each change.
   *
   * @param cb Callback that receives the typed presence state
   * @returns Unsubscribe function
   */
  subscribe(
    cb: (state: { self: Infer<S>; all: Record<string, Infer<S>> }) => void,
  ): () => void {
    // Initial call
    cb({ self: this.self, all: this.all })

    return this.presence.subscribe(() => {
      cb({ self: this.self, all: this.all })
    })
  }
}
