// biome-ignore-all lint/suspicious/noExplicitAny: provided by https://www.npmjs.com/package/fast-deep-equal
// biome-ignore-all lint/suspicious/noImplicitAnyLet: provided by https://www.npmjs.com/package/fast-deep-equal
// biome-ignore-all lint/suspicious/noDoubleEquals: original code does this

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function equal(a: any, b: any): boolean {
  if (a === b) return true

  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) return false

    let length: number, i: any, keys: string[]

    if (Array.isArray(a)) {
      length = a.length

      if (length != b.length) return false

      for (i = length; i-- !== 0; ) if (!equal(a[i], b[i])) return false

      return true
    }

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false

      for (i of a.entries()) if (!b.has(i[0])) return false

      for (i of a.entries()) if (!equal(i[1], b.get(i[0]))) return false

      return true
    }

    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false

      for (i of a.entries()) if (!b.has(i[0])) return false

      return true
    }

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      length = a.byteLength

      if (length != b.byteLength) return false

      for (i = length; i-- !== 0; )
        if ((a as any)[i] !== (b as any)[i]) return false

      return true
    }

    if (a.constructor === RegExp)
      return a.source === b.source && a.flags === b.flags

    if (a.valueOf !== Object.prototype.valueOf)
      return a.valueOf() === b.valueOf()

    if (a.toString !== Object.prototype.toString)
      return a.toString() === b.toString()

    keys = Object.keys(a)

    length = keys.length

    if (length !== Object.keys(b).length) return false

    for (i = length; i-- !== 0; )
      // biome-ignore lint/suspicious/noPrototypeBuiltins: original code does this
      if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false

    for (i = length; i-- !== 0; ) {
      const key = keys[i]

      if (!equal(a[key], b[key])) return false
    }

    return true
  }

  // biome-ignore lint/suspicious/noSelfCompare: true if both NaN, false otherwise
  return a !== a && b !== b
}
