export type Result<T, E extends Error = Error> =
  | {
      type: "success"
      result: T
    }
  | {
      type: "error"
      error: E
    }

export class TimeoutError extends Error {
  constructor(msg?: string) {
    super(msg ?? "Timed out")
  }
}

/**
 * A utility function to run an async function with timeout and return a Result type
 *
 * @param fn An async function to execute
 * @param timeout Amount of time to wait, in ms. If timeout is exceeded, returns error result (does not throw)
 * @returns
 */
export async function withTimeout<T, E extends Error = Error>(
  fn: () => Promise<T>,
  timeout: number,
): Promise<Result<T, E | TimeoutError | Error>> {
  const valuePromise = new Promise<Result<T, E | TimeoutError | Error>>((resolve) => {
    fn()
      .then(result => resolve({ type: "success", result }))
      .catch(error => {
        // Wrap non-Error objects in an Error
        const wrappedError = error instanceof Error ? error : new Error(String(error))
        resolve({ type: "error", error: wrappedError })
      })
  })

  if (timeout <= 0) {
    return await valuePromise
  }

  const timeoutPromise = new Promise<Result<T, E | TimeoutError | Error>>(resolve => {
    setTimeout(
      () => resolve({ type: "error", error: new TimeoutError() }),
      timeout,
    )
  })

  return await Promise.race([valuePromise, timeoutPromise])
}
