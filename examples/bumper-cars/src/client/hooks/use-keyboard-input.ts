import { useEffect, useMemo, useState } from "react"
import type { InputState } from "../../shared/types"

// Stable reference for zero input
const ZERO_INPUT: InputState = { force: 0, angle: 0 }

// Initial keys state
const INITIAL_KEYS = {
  up: false,
  down: false,
  left: false,
  right: false,
}

/**
 * Hook for keyboard input (WASD/Arrow keys)
 *
 * Handles:
 * - WASD and arrow key input
 * - Ignores key repeat events to prevent render storms
 * - Resets keys on window blur to prevent "stuck" keys
 * - Prevents arrow key page scrolling
 */
export function useKeyboardInput(): InputState {
  const [keys, setKeys] = useState(INITIAL_KEYS)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key repeat events - only handle initial press
      if (e.repeat) return

      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          e.preventDefault() // Prevent page scroll
          setKeys(k => ({ ...k, up: true }))
          break
        case "s":
        case "arrowdown":
          e.preventDefault()
          setKeys(k => ({ ...k, down: true }))
          break
        case "a":
        case "arrowleft":
          e.preventDefault()
          setKeys(k => ({ ...k, left: true }))
          break
        case "d":
        case "arrowright":
          e.preventDefault()
          setKeys(k => ({ ...k, right: true }))
          break
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          setKeys(k => ({ ...k, up: false }))
          break
        case "s":
        case "arrowdown":
          setKeys(k => ({ ...k, down: false }))
          break
        case "a":
        case "arrowleft":
          setKeys(k => ({ ...k, left: false }))
          break
        case "d":
        case "arrowright":
          setKeys(k => ({ ...k, right: false }))
          break
      }
    }

    // Reset all keys when window loses focus to prevent "stuck" keys
    const handleBlur = () => {
      setKeys(INITIAL_KEYS)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [])

  // Memoize the input state to prevent unnecessary re-renders
  return useMemo(() => {
    // Convert keys to input state
    let dx = 0
    let dy = 0

    if (keys.up) dy -= 1
    if (keys.down) dy += 1
    if (keys.left) dx -= 1
    if (keys.right) dx += 1

    // No input - return stable reference
    if (dx === 0 && dy === 0) {
      return ZERO_INPUT
    }

    // Calculate angle and force
    const angle = Math.atan2(dy, dx)
    const force = Math.min(Math.sqrt(dx * dx + dy * dy), 1)

    return { force, angle }
  }, [keys.up, keys.down, keys.left, keys.right])
}
