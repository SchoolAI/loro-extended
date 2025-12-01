import { useCallback, useEffect, useRef, useState } from "react"
import type { InputState } from "../../shared/types"

// Stable reference for zero input
const ZERO_INPUT: InputState = { force: 0, angle: 0 }

export function useJoystick() {
  const [input, setInput] = useState<InputState>(ZERO_INPUT)
  const managerRef = useRef<any>(null)
  const zoneElementRef = useRef<HTMLDivElement | null>(null)

  // Initialize nipplejs when zone element is available
  const initJoystick = useCallback(async (element: HTMLDivElement) => {
    // Clean up existing manager
    if (managerRef.current) {
      managerRef.current.destroy()
      managerRef.current = null
    }

    // Dynamic import of nipplejs
    const nipplejs = await import("nipplejs")
    const nippleModule = nipplejs.default || nipplejs

    const manager = nippleModule.create({
      zone: element,
      mode: "dynamic", // Dynamic mode works better for touch/click anywhere
      color: "rgba(255, 255, 255, 0.5)",
      size: 120,
    })

    managerRef.current = manager

    manager.on(
      "move",
      (_evt: unknown, data: { force: number; angle: { radian: number } }) => {
        // Normalize force to 0-1 range (nipplejs gives 0-2 typically)
        const normalizedForce = Math.min(data.force / 2, 1)
        // Invert the Y-axis: nipplejs uses mathematical coordinates (Y up),
        // but we want screen coordinates (Y down). Negate the angle.
        const invertedAngle = -data.angle.radian
        setInput({
          force: normalizedForce,
          angle: invertedAngle,
        })
      },
    )

    manager.on("end", () => {
      setInput(ZERO_INPUT)
    })
  }, [])

  // Callback ref to handle when the element is mounted/unmounted
  const zoneRef = useCallback(
    (element: HTMLDivElement | null) => {
      zoneElementRef.current = element

      if (element) {
        initJoystick(element)
      } else if (managerRef.current) {
        managerRef.current.destroy()
        managerRef.current = null
      }
    },
    [initJoystick],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.destroy()
        managerRef.current = null
      }
    }
  }, [])

  return { input, zoneRef }
}
