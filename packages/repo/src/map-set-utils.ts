/**
 * Helper method to add a peer to a set in a map.
 */
export function addToSet<T, U>(map: Map<T, Set<U>>, key: T, values: U[]): void {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  for (const value of values) {
    set.add(value)
  }
}

/**
 * Helper method to remove a peer from a set in a map.
 */
export function removeFromSet<T, U>(
  map: Map<T, Set<U>>,
  key: T,
  values: U[],
): void {
  const set = map.get(key)
  if (set) {
    for (const value of values) {
      set.delete(value)
      if (set.size === 0) {
        map.delete(key)
      }
    }
  }
}
