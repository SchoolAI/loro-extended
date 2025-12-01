import type { PeerID } from "@loro-extended/repo"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CAR_BOUNCE,
  CAR_RADIUS,
  type CarState,
  type ClientPresence,
  type Collision,
  FRICTION,
  MAX_SPEED,
  WALL_BOUNCE,
} from "../shared/types.js"

/**
 * Apply input to a car's velocity
 */
export function applyInput(
  car: CarState,
  input: ClientPresence["input"],
): CarState {
  if (input.force > 0) {
    // Apply acceleration in the direction of the joystick
    const ax = Math.cos(input.angle) * input.force * 0.5
    const ay = Math.sin(input.angle) * input.force * 0.5

    car.vx += ax
    car.vy += ay

    // Update rotation to face movement direction
    car.rotation = input.angle
  }

  return car
}

/**
 * Apply friction and clamp velocity
 */
export function applyFriction(car: CarState): CarState {
  car.vx *= FRICTION
  car.vy *= FRICTION

  // Clamp to max speed
  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy)
  if (speed > MAX_SPEED) {
    car.vx = (car.vx / speed) * MAX_SPEED
    car.vy = (car.vy / speed) * MAX_SPEED
  }

  // Stop very slow movement
  if (Math.abs(car.vx) < 0.01) car.vx = 0
  if (Math.abs(car.vy) < 0.01) car.vy = 0

  return car
}

/**
 * Update car position based on velocity
 */
export function updatePosition(car: CarState): CarState {
  car.x += car.vx
  car.y += car.vy
  return car
}

/**
 * Handle wall collisions with bounce
 */
export function handleWallCollisions(car: CarState): CarState {
  // Left wall
  if (car.x - CAR_RADIUS < 0) {
    car.x = CAR_RADIUS
    car.vx = -car.vx * WALL_BOUNCE
  }
  // Right wall
  if (car.x + CAR_RADIUS > ARENA_WIDTH) {
    car.x = ARENA_WIDTH - CAR_RADIUS
    car.vx = -car.vx * WALL_BOUNCE
  }
  // Top wall
  if (car.y - CAR_RADIUS < 0) {
    car.y = CAR_RADIUS
    car.vy = -car.vy * WALL_BOUNCE
  }
  // Bottom wall
  if (car.y + CAR_RADIUS > ARENA_HEIGHT) {
    car.y = ARENA_HEIGHT - CAR_RADIUS
    car.vy = -car.vy * WALL_BOUNCE
  }

  return car
}

/**
 * Minimum speed required to score a hit (prevents scoring when barely moving)
 */
const MIN_HIT_SPEED = 0.5

/**
 * Check if a car hit another car with its front using velocity-based detection.
 *
 * A car scores a hit if:
 * 1. It's moving fast enough (speed > MIN_HIT_SPEED)
 * 2. Its velocity is pointing toward the other car (within ±60°)
 * 3. It has positive relative velocity toward the other car (actively approaching)
 *
 * This is more accurate than rotation-based detection because a car can be
 * moving in a different direction than it's pointing (e.g., after bouncing).
 */
function isHitWithFront(car: CarState, otherCar: CarState): boolean {
  // Check 1: Car must be moving fast enough
  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy)
  if (speed < MIN_HIT_SPEED) {
    return false
  }

  // Direction from this car to the other car
  const dx = otherCar.x - car.x
  const dy = otherCar.y - car.y
  const angleToOther = Math.atan2(dy, dx)

  // Check 2: Velocity must be pointing toward the other car
  // Use velocity direction instead of rotation
  const velocityAngle = normalizeAngle(Math.atan2(car.vy, car.vx))
  const collisionAngle = normalizeAngle(angleToOther)

  // Calculate the angular difference between velocity and collision direction
  let angleDiff = Math.abs(velocityAngle - collisionAngle)
  if (angleDiff > Math.PI) {
    angleDiff = 2 * Math.PI - angleDiff
  }

  // Front arc is ±60 degrees (π/3 radians)
  const FRONT_ARC = Math.PI / 3
  if (angleDiff >= FRONT_ARC) {
    return false
  }

  // Check 3: Car must have positive relative velocity toward the other car
  // This ensures the car is actively moving toward the other car, not away
  const distance = Math.sqrt(dx * dx + dy * dy)
  if (distance === 0) return false

  const nx = dx / distance // Unit vector toward other car
  const ny = dy / distance

  // Dot product of velocity with direction to other car
  // Positive means moving toward, negative means moving away
  const approachSpeed = car.vx * nx + car.vy * ny

  return approachSpeed > 0
}

/**
 * Normalize angle to [0, 2π)
 */
function normalizeAngle(angle: number): number {
  let normalized = angle % (2 * Math.PI)
  if (normalized < 0) {
    normalized += 2 * Math.PI
  }
  return normalized
}

/**
 * Check and handle collision between two cars
 * Returns collision info if they collided, including which car(s) scored
 * A car scores only if it hit with its front
 */
export function checkCarCollision(
  peer1: PeerID,
  car1: CarState,
  peer2: PeerID,
  car2: CarState,
): Collision | null {
  const dx = car2.x - car1.x
  const dy = car2.y - car1.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDistance = CAR_RADIUS * 2

  if (distance < minDistance && distance > 0) {
    // Normalize collision vector
    const nx = dx / distance
    const ny = dy / distance

    // Relative velocity
    const dvx = car1.vx - car2.vx
    const dvy = car1.vy - car2.vy

    // Relative velocity along collision normal
    const dvn = dvx * nx + dvy * ny

    // Only resolve if cars are moving towards each other
    if (dvn > 0) {
      // Impulse scalar (assuming equal mass)
      const impulse = dvn * CAR_BOUNCE

      // Apply impulse
      car1.vx -= impulse * nx
      car1.vy -= impulse * ny
      car2.vx += impulse * nx
      car2.vy += impulse * ny

      // Separate cars to prevent overlap
      const overlap = minDistance - distance
      const separationX = (overlap / 2 + 1) * nx
      const separationY = (overlap / 2 + 1) * ny

      car1.x -= separationX
      car1.y -= separationY
      car2.x += separationX
      car2.y += separationY

      // Determine who scored - only cars that hit with their front
      const scorers: PeerID[] = []
      if (isHitWithFront(car1, car2)) {
        scorers.push(peer1)
      }
      if (isHitWithFront(car2, car1)) {
        scorers.push(peer2)
      }

      return {
        peer1,
        peer2,
        timestamp: Date.now(),
        scorers,
      }
    }
  }

  return null
}

/**
 * Get a random spawn position that doesn't overlap with existing cars
 */
export function getSpawnPosition(existingCars: CarState[]): {
  x: number
  y: number
} {
  const margin = CAR_RADIUS * 3
  const maxAttempts = 50

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = margin + Math.random() * (ARENA_WIDTH - margin * 2)
    const y = margin + Math.random() * (ARENA_HEIGHT - margin * 2)

    // Check if position is clear
    let clear = true
    for (const car of existingCars) {
      const dx = car.x - x
      const dy = car.y - y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < CAR_RADIUS * 3) {
        clear = false
        break
      }
    }

    if (clear) {
      return { x, y }
    }
  }

  // Fallback to center if no clear spot found
  return {
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
  }
}
