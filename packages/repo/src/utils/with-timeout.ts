/**
 * Wraps a promise with a timeout that properly cleans up to avoid unhandled rejections.
 *
 * Unlike `Promise.race([promise, timeoutPromise])`, this implementation:
 * - Properly clears the timeout when the promise resolves/rejects
 * - Avoids unhandled rejection warnings from the timeout promise
 * - Supports AbortSignal for cancellation
 *
 * @param promise - The promise to wrap
 * @param options - Timeout options
 * @returns The result of the promise, or throws TimeoutError/AbortError
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   fetchData(),
 *   {
 *     timeoutMs: 5000,
 *     createTimeoutError: () => new Error("Fetch timed out"),
 *   }
 * )
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: {
    /**
     * Timeout in milliseconds. Set to 0 to disable timeout.
     */
    timeoutMs: number

    /**
     * Factory function to create the timeout error.
     * Called only when timeout actually occurs.
     */
    createTimeoutError: () => Error

    /**
     * Optional AbortSignal for cancellation.
     * If aborted, the promise rejects with an AbortError.
     */
    signal?: AbortSignal
  },
): Promise<T> {
  const { timeoutMs, createTimeoutError, signal } = options

  // If already aborted, reject immediately
  if (signal?.aborted) {
    throw new DOMException("Operation was aborted", "AbortError")
  }

  // If timeout is 0, just wait for the promise (with abort support)
  if (timeoutMs === 0) {
    if (!signal) {
      return promise
    }

    // Wait for promise or abort
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(new DOMException("Operation was aborted", "AbortError"))
      }

      signal.addEventListener("abort", onAbort, { once: true })

      promise
        .then(result => {
          signal.removeEventListener("abort", onAbort)
          resolve(result)
        })
        .catch(err => {
          signal.removeEventListener("abort", onAbort)
          reject(err)
        })
    })
  }

  // Race between promise, timeout, and abort
  return new Promise<T>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      settled = true
      clearTimeout(timeoutId)
      if (signal) {
        signal.removeEventListener("abort", onAbort)
      }
    }

    const timeoutId = setTimeout(() => {
      if (!settled) {
        cleanup()
        reject(createTimeoutError())
      }
    }, timeoutMs)

    const onAbort = () => {
      if (!settled) {
        cleanup()
        reject(new DOMException("Operation was aborted", "AbortError"))
      }
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    promise
      .then(result => {
        if (!settled) {
          cleanup()
          resolve(result)
        }
      })
      .catch(err => {
        if (!settled) {
          cleanup()
          reject(err)
        }
      })
  })
}
