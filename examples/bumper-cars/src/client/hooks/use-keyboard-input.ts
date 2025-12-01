import { useEffect, useMemo, useState } from "react"
import type { InputState } from "../../shared/types"

// Stable reference for zero input
const ZERO_INPUT: InputState = { force: 0, angle: 0 }

/**
 * Hook for keyboard input (WASD/Arrow keys)
 */
export function useKeyboardInput(): InputState {
  const [keys, setKeys] = useState({
    up: false,
    down: false,
    left: false,
    right: false,
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case "w":
        case "arrowup":
          setKeys(k => ({ ...k, up: true }))
          break
        case "s":
        case "arrowdown":
          setKeys(k => ({ ...k, down: true }))
          break
        case "a":
        case "arrowleft":
          setKeys(k => ({ ...k, left: true }))
          break
        case "d":
        case "arrowright":
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

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
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
