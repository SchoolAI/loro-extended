/**
 * WebSocket Client State Machine
 *
 * Provides a unified, observable state machine for WebSocket connection lifecycle.
 * All state transitions are delivered asynchronously via microtask queue to ensure
 * observers can reliably see all states, even when multiple transitions happen
 * in the same synchronous call stack.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Reason for disconnection.
 */
export type DisconnectReason =
  | { type: "intentional" }
  | { type: "error"; error: Error }
  | { type: "closed"; code: number; reason: string }
  | { type: "max-retries-exceeded"; attempts: number }
  | { type: "not-started" }

/**
 * All possible states of the WebSocket client.
 */
export type WsClientState =
  | { status: "disconnected"; reason?: DisconnectReason }
  | { status: "connecting"; attempt: number }
  | { status: "connected" } // Socket open, waiting for ready signal
  | { status: "ready" } // Socket open AND server ready signal received
  | { status: "reconnecting"; attempt: number; nextAttemptMs: number }

/**
 * A state transition event.
 */
export type WsClientStateTransition = {
  from: WsClientState
  to: WsClientState
  timestamp: number
}

/**
 * Listener for state transitions.
 */
export type TransitionListener = (transition: WsClientStateTransition) => void

/**
 * Legacy listener for backward compatibility with `subscribe()`.
 * Receives only the status string.
 */
export type LegacyStateListener = (
  state: "disconnected" | "connecting" | "connected" | "reconnecting",
) => void

// ============================================================================
// Valid Transitions
// ============================================================================

/**
 * Map of valid state transitions.
 * Key is the "from" status, value is array of valid "to" statuses.
 */
const VALID_TRANSITIONS: Record<
  WsClientState["status"],
  WsClientState["status"][]
> = {
  disconnected: ["connecting"],
  connecting: ["connected", "disconnected", "reconnecting"],
  connected: ["ready", "disconnected", "reconnecting"],
  ready: ["disconnected", "reconnecting"],
  reconnecting: ["connecting", "disconnected"],
}

/**
 * Check if a transition is valid.
 */
function isValidTransition(
  from: WsClientState["status"],
  to: WsClientState["status"],
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ============================================================================
// State Machine
// ============================================================================

/**
 * WebSocket Client State Machine.
 *
 * Manages connection state with guaranteed observable transitions.
 * All transitions are delivered asynchronously via microtask queue.
 */
export class WsClientStateMachine {
  private currentState: WsClientState = { status: "disconnected" }
  private transitionListeners = new Set<TransitionListener>()
  private legacyListeners = new Set<LegacyStateListener>()
  private pendingTransitions: WsClientStateTransition[] = []
  private isProcessingQueue = false

  /**
   * Get the current state synchronously.
   */
  getState(): WsClientState {
    return this.currentState
  }

  /**
   * Get the current status string (for backward compatibility).
   */
  getStatus(): WsClientState["status"] {
    return this.currentState.status
  }

  /**
   * Get a legacy-compatible connection state string.
   * Maps "ready" to "connected" for backward compatibility.
   */
  getLegacyConnectionState():
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting" {
    const status = this.currentState.status
    // Map "ready" to "connected" for backward compatibility
    return status === "ready" ? "connected" : status
  }

  /**
   * Check if the client is in a "connected" state (either connected or ready).
   */
  isConnectedOrReady(): boolean {
    return (
      this.currentState.status === "connected" ||
      this.currentState.status === "ready"
    )
  }

  /**
   * Check if the client is ready (server ready signal received).
   */
  isReady(): boolean {
    return this.currentState.status === "ready"
  }

  /**
   * Transition to a new state.
   *
   * @param newState The new state to transition to
   * @param options Options for the transition
   * @throws Error if the transition is invalid
   */
  transition(newState: WsClientState, options?: { force?: boolean }): void {
    const fromStatus = this.currentState.status
    const toStatus = newState.status

    // Validate transition unless forced
    if (!options?.force && !isValidTransition(fromStatus, toStatus)) {
      throw new Error(
        `Invalid state transition: ${fromStatus} -> ${toStatus}. ` +
          `Valid transitions from ${fromStatus}: ${VALID_TRANSITIONS[fromStatus]?.join(", ") ?? "none"}`,
      )
    }

    const transition: WsClientStateTransition = {
      from: this.currentState,
      to: newState,
      timestamp: Date.now(),
    }

    // Update current state immediately (synchronous)
    this.currentState = newState

    // Queue transition for async delivery
    this.pendingTransitions.push(transition)
    this.scheduleDelivery()
  }

  /**
   * Subscribe to state transitions.
   *
   * @param listener Callback that receives transition events
   * @returns Unsubscribe function
   */
  subscribeToTransitions(listener: TransitionListener): () => void {
    this.transitionListeners.add(listener)
    return () => {
      this.transitionListeners.delete(listener)
    }
  }

  /**
   * Subscribe to state changes (legacy API for backward compatibility).
   *
   * @deprecated Use subscribeToTransitions() instead
   * @param listener Callback that receives the new state status
   * @returns Unsubscribe function
   */
  subscribe(listener: LegacyStateListener): () => void {
    this.legacyListeners.add(listener)
    // Emit current state immediately (legacy behavior)
    listener(this.getLegacyConnectionState())
    return () => {
      this.legacyListeners.delete(listener)
    }
  }

  /**
   * Wait for a specific state.
   *
   * @param predicate Function that returns true when the desired state is reached
   * @param options Options including timeout
   * @returns Promise that resolves with the matching state
   */
  waitForState(
    predicate: (state: WsClientState) => boolean,
    options?: { timeoutMs?: number },
  ): Promise<WsClientState> {
    // Check if already in desired state
    if (predicate(this.currentState)) {
      return Promise.resolve(this.currentState)
    }

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const unsubscribe = this.subscribeToTransitions(transition => {
        if (predicate(transition.to)) {
          cleanup()
          resolve(transition.to)
        }
      })

      const cleanup = () => {
        unsubscribe()
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }

      if (options?.timeoutMs) {
        timeoutId = setTimeout(() => {
          cleanup()
          reject(
            new Error(`Timeout waiting for state after ${options.timeoutMs}ms`),
          )
        }, options.timeoutMs)
      }
    })
  }

  /**
   * Wait for a specific status.
   *
   * @param status The status to wait for
   * @param options Options including timeout
   * @returns Promise that resolves with the matching state
   */
  waitForStatus(
    status: WsClientState["status"],
    options?: { timeoutMs?: number },
  ): Promise<WsClientState> {
    return this.waitForState(state => state.status === status, options)
  }

  /**
   * Reset the state machine to initial state.
   */
  reset(): void {
    this.currentState = { status: "disconnected" }
    this.pendingTransitions = []
  }

  /**
   * Schedule delivery of pending transitions via microtask queue.
   */
  private scheduleDelivery(): void {
    if (this.isProcessingQueue) {
      return
    }

    this.isProcessingQueue = true
    queueMicrotask(() => {
      this.deliverPendingTransitions()
    })
  }

  /**
   * Deliver all pending transitions to listeners.
   */
  private deliverPendingTransitions(): void {
    // Take all pending transitions
    const transitions = this.pendingTransitions
    this.pendingTransitions = []
    this.isProcessingQueue = false

    // Deliver each transition to all listeners
    for (const transition of transitions) {
      // Deliver to transition listeners
      for (const listener of this.transitionListeners) {
        try {
          listener(transition)
        } catch (error) {
          console.error("Error in transition listener:", error)
        }
      }

      // Deliver to legacy listeners (only status string)
      const legacyState =
        transition.to.status === "ready" ? "connected" : transition.to.status
      for (const listener of this.legacyListeners) {
        try {
          listener(
            legacyState as
              | "disconnected"
              | "connecting"
              | "connected"
              | "reconnecting",
          )
        } catch (error) {
          console.error("Error in legacy state listener:", error)
        }
      }
    }
  }
}
