import type { PeerID } from "@loro-extended/repo"
import { useEffect, useRef } from "react"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CAR_HEIGHT,
  CAR_RADIUS,
  CAR_WIDTH,
  type ServerPresence,
} from "../../shared/types"

type ArenaCanvasProps = {
  serverPresence: ServerPresence | null
  myPeerId: PeerID
}

export function ArenaCanvas({ serverPresence, myPeerId }: ArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prevCarsRef = useRef<ServerPresence["cars"]>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas size
    const updateSize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (rect) {
        canvas.width = rect.width
        canvas.height = rect.height
      }
    }
    updateSize()
    window.addEventListener("resize", updateSize)

    // Animation loop
    let animationId: number

    const render = () => {
      const { width, height } = canvas

      // Calculate scale to fit arena in canvas
      const scaleX = width / ARENA_WIDTH
      const scaleY = height / ARENA_HEIGHT
      const scale = Math.min(scaleX, scaleY)

      // Center the arena
      const offsetX = (width - ARENA_WIDTH * scale) / 2
      const offsetY = (height - ARENA_HEIGHT * scale) / 2

      // Clear canvas
      ctx.fillStyle = "#1a1a2e"
      ctx.fillRect(0, 0, width, height)

      // Draw arena background
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)

      // Arena floor
      ctx.fillStyle = "#16213e"
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT)

      // Arena border
      ctx.strokeStyle = "#4ECDC4"
      ctx.lineWidth = 4
      ctx.strokeRect(2, 2, ARENA_WIDTH - 4, ARENA_HEIGHT - 4)

      // Grid lines
      ctx.strokeStyle = "rgba(78, 205, 196, 0.1)"
      ctx.lineWidth = 1
      const gridSize = 50
      for (let x = gridSize; x < ARENA_WIDTH; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ARENA_HEIGHT)
        ctx.stroke()
      }
      for (let y = gridSize; y < ARENA_HEIGHT; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(ARENA_WIDTH, y)
        ctx.stroke()
      }

      // Draw cars
      if (serverPresence) {
        const cars = serverPresence.cars

        // Interpolate positions for smoothness
        const interpolatedCars = { ...cars }
        for (const [peerId, car] of Object.entries(cars)) {
          const prevCar = prevCarsRef.current[peerId as PeerID]
          if (prevCar) {
            // Simple linear interpolation
            const t = 0.3
            interpolatedCars[peerId as PeerID] = {
              ...car,
              x: prevCar.x + (car.x - prevCar.x) * t,
              y: prevCar.y + (car.y - prevCar.y) * t,
            }
          }
        }
        prevCarsRef.current = interpolatedCars

        // Draw each car
        const now = Date.now()
        for (const [peerId, car] of Object.entries(interpolatedCars)) {
          const isMe = peerId === myPeerId
          const isHit = car.hitUntil > now

          ctx.save()

          // Apply shake effect if car is hit
          let shakeX = 0
          let shakeY = 0
          if (isHit) {
            const shakeIntensity = 4
            shakeX = (Math.random() - 0.5) * shakeIntensity * 2
            shakeY = (Math.random() - 0.5) * shakeIntensity * 2
          }

          ctx.translate(car.x + shakeX, car.y + shakeY)
          ctx.rotate(car.rotation)

          // Car body (rounded rectangle)
          ctx.fillStyle = car.color
          ctx.beginPath()
          const halfW = CAR_WIDTH / 2
          const halfH = CAR_HEIGHT / 2
          const radius = 8
          ctx.roundRect(-halfW, -halfH, CAR_WIDTH, CAR_HEIGHT, radius)
          ctx.fill()

          // Flash effect when hit - draw a white overlay
          if (isHit) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)"
            ctx.fill()
          }

          // Car outline (thicker for self, red when hit)
          if (isHit) {
            ctx.strokeStyle = "#FF0000"
            ctx.lineWidth = 4
          } else {
            ctx.strokeStyle = isMe ? "#fff" : "rgba(255,255,255,0.3)"
            ctx.lineWidth = isMe ? 3 : 1
          }
          ctx.stroke()

          // Front indicator (direction)
          ctx.fillStyle = "rgba(255,255,255,0.8)"
          ctx.beginPath()
          ctx.arc(halfW - 8, 0, 4, 0, Math.PI * 2)
          ctx.fill()

          ctx.restore()

          // Draw name label above car (with shake if hit)
          ctx.fillStyle = "#fff"
          ctx.font = "bold 12px sans-serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "bottom"
          ctx.fillText(
            car.name,
            car.x + shakeX,
            car.y - CAR_RADIUS - 5 + shakeY,
          )

          // Draw "YOU" indicator for self
          if (isMe) {
            ctx.fillStyle = "#4ECDC4"
            ctx.font = "bold 10px sans-serif"
            ctx.fillText(
              "YOU",
              car.x + shakeX,
              car.y - CAR_RADIUS - 18 + shakeY,
            )
          }

          // Draw "HIT!" indicator when hit
          if (isHit) {
            ctx.fillStyle = "#FF0000"
            ctx.font = "bold 14px sans-serif"
            ctx.fillText("💥", car.x + shakeX, car.y + shakeY)
          }
        }
      }

      ctx.restore()

      animationId = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener("resize", updateSize)
      cancelAnimationFrame(animationId)
    }
  }, [serverPresence, myPeerId])

  return <canvas ref={canvasRef} />
}
