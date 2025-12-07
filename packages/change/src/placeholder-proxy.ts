/**
 * Creates a proxy around a placeholder value (plain object/array) that mimics
 * the behavior of TypedRef, specifically adding a .toJSON() method.
 *
 * This ensures consistent UX where users can call .toJSON() on document state
 * regardless of whether it's loading (placeholder) or loaded (live ref).
 */
export function createPlaceholderProxy<T extends object>(target: T): T {
  // Cache for wrapped properties to ensure referential stability
  const cache = new Map<string | symbol, any>()

  return new Proxy(target, {
    get(target, prop, receiver) {
      // Intercept .toJSON()
      if (prop === "toJSON") {
        return () => target
      }

      // Check cache first
      if (cache.has(prop)) {
        return cache.get(prop)
      }

      // Get value from target
      const value = Reflect.get(target, prop, receiver)

      // Recursively wrap objects/arrays
      if (value && typeof value === "object") {
        const wrapped = createPlaceholderProxy(value)
        cache.set(prop, wrapped)
        return wrapped
      }

      return value
    },
  })
}
