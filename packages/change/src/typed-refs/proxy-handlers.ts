import { INTERNAL_SYMBOL } from "./base.js"
import type { ListRef } from "./list-ref.js"
import type { MovableListRef } from "./movable-list-ref.js"
import type { RecordRef } from "./record-ref.js"
import type { RecordRefInternals } from "./record-ref-internals.js"

export const recordProxyHandler: ProxyHandler<RecordRef<any>> = {
  get: (target, prop) => {
    if (typeof prop === "string" && !(prop in target)) {
      // Use getRef for reading - returns undefined for non-existent keys
      return (target[INTERNAL_SYMBOL] as RecordRefInternals<any>).getRef(prop)
    }
    return Reflect.get(target, prop)
  },

  set: (target, prop, value) => {
    if (typeof prop === "string" && !(prop in target)) {
      target.set(prop, value)
      return true
    }
    return Reflect.set(target, prop, value)
  },

  deleteProperty: (target, prop) => {
    if (typeof prop === "string" && !(prop in target)) {
      target.delete(prop)
      return true
    }
    return Reflect.deleteProperty(target, prop)
  },

  // Support `in` operator for checking key existence
  has: (target, prop) => {
    if (typeof prop === "string") {
      // Check if it's a method/property on the class first
      if (prop in target) {
        return true
      }
      // Otherwise check the underlying container
      return target.has(prop)
    }
    return Reflect.has(target, prop)
  },

  ownKeys: target => {
    return target.keys()
  },

  getOwnPropertyDescriptor: (target, prop) => {
    if (typeof prop === "string" && target.has(prop)) {
      return {
        configurable: true,
        enumerable: true,
        value: target.get(prop),
      }
    }
    return Reflect.getOwnPropertyDescriptor(target, prop)
  },
}

export const listProxyHandler: ProxyHandler<ListRef<any>> = {
  get: (target, prop) => {
    if (typeof prop === "string") {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        return target.get(index)
      }
    }
    return Reflect.get(target, prop)
  },

  set: (target, prop, value) => {
    if (typeof prop === "string") {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        // For lists, assignment to index implies replacement
        target.delete(index, 1)
        target.insert(index, value)
        return true
      }
    }
    return Reflect.set(target, prop, value)
  },
}

export const movableListProxyHandler: ProxyHandler<MovableListRef<any>> = {
  get: (target, prop) => {
    if (typeof prop === "string") {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        return target.get(index)
      }
    }
    return Reflect.get(target, prop)
  },

  set: (target, prop, value) => {
    if (typeof prop === "string") {
      const index = Number(prop)
      if (!Number.isNaN(index)) {
        // MovableList supports set directly
        target.set(index, value)
        return true
      }
    }
    return Reflect.set(target, prop, value)
  },
}
