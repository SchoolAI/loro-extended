export type RequestId = number

let lastRequestId = 0

/**
 * A utility class for tracking pending requests and their resolutions.
 * This provides a standardized way to handle promises across the codebase.
 */
export class RequestTracker<T> {
  #pendingRequests = new Map<RequestId, PromiseResolver<T>>()

  /**
   * Creates a new request and returns its ID and a promise that will resolve or reject
   * when the request is completed.
   */
  createRequest(): [RequestId, Promise<T>] {
    const requestId = this.generateRequestId()
    const promise = new Promise<T>((resolve, reject) => {
      this.#pendingRequests.set(requestId, { resolve, reject })
    })
    return [requestId, promise]
  }

  /**
   * Resolves a pending request with the given value.
   * @returns true if the request was found and resolved, false otherwise
   */
  resolve(requestId: RequestId, value: T): boolean {
    const request = this.#pendingRequests.get(requestId)
    if (request) {
      request.resolve(value)
      this.#pendingRequests.delete(requestId)
      return true
    }
    return false
  }

  /**
   * Rejects a pending request with the given error.
   * @returns true if the request was found and rejected, false otherwise
   */
  reject(requestId: RequestId, error: Error): boolean {
    const request = this.#pendingRequests.get(requestId)
    if (request) {
      request.reject(error)
      this.#pendingRequests.delete(requestId)
      return true
    }
    return false
  }

  /**
   * Checks if a request with the given ID is still pending.
   */
  has(requestId: RequestId): boolean {
    return this.#pendingRequests.has(requestId)
  }

  /**
   * Gets the number of pending requests.
   */
  get size(): number {
    return this.#pendingRequests.size
  }

  /**
   * Clears all pending requests, optionally rejecting them with an error.
   */
  clear(error?: Error): void {
    if (error) {
      for (const [_, request] of this.#pendingRequests) {
        request.reject(error)
      }
    }
    this.#pendingRequests.clear()
  }

  /**
   * Generates a unique request ID.
   */
  private generateRequestId(): RequestId {
    return lastRequestId++
  }
}

/**
 * A resolver for a promise, containing both resolve and reject functions.
 */
interface PromiseResolver<T> {
  resolve: (value: T) => void
  reject: (reason?: Error) => void
}
