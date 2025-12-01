import { createTypedDoc, type Draft } from "@loro-extended/change"
import type { DocHandle, PeerID } from "@loro-extended/repo"
import {
  ArenaSchema,
  type CarState,
  type ClientPresence,
  type Collision,
  EmptyArena,
  type GamePresence,
  type ServerPresence,
  TICK_INTERVAL,
} from "../shared/types.js"
import { logger } from "./config.js"
import {
  applyFriction,
  applyInput,
  checkCarCollision,
  getSpawnPosition,
  handleWallCollisions,
  updatePosition,
} from "./physics.js"

/**
 * Server-side game loop that runs physics simulation
 */
// Duration of the hit effect in milliseconds
const HIT_EFFECT_DURATION = 300

export class GameLoop {
  private cars: Map<PeerID, CarState> = new Map()
  private tick = 0
  private intervalId: ReturnType<typeof setInterval> | null = null
  private recentCollisions: Map<string, number> = new Map()
  private readonly COLLISION_COOLDOWN = 500 // ms

  private handle: DocHandle
  private getPresence: () => Record<string, GamePresence>
  private setPresence: (presence: ServerPresence) => void

  constructor(
    handle: DocHandle,
    getPresence: () => Record<string, GamePresence>,
    setPresence: (presence: ServerPresence) => void,
  ) {
    this.handle = handle
    this.getPresence = getPresence
    this.setPresence = setPresence
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.intervalId) return

    logger.info`Starting game loop at ${TICK_INTERVAL}ms interval`

    this.intervalId = setInterval(() => {
      this.update()
    }, TICK_INTERVAL)
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      logger.info`Game loop stopped`
    }
  }

  /**
   * Main update function - runs every tick
   */
  private update(): void {
    this.tick++

    // Get all client presences
    const allPresence = this.getPresence()
    const clientInputs = this.getClientInputs(allPresence)

    // Update existing cars and remove disconnected ones
    this.syncCarsWithClients(clientInputs)

    // Apply inputs and physics to all cars
    for (const [peerId, car] of this.cars) {
      const input = clientInputs.get(peerId)
      if (input) {
        applyInput(car, input.input)
      }
      applyFriction(car)
      updatePosition(car)
      handleWallCollisions(car)
    }

    // Check for car-to-car collisions
    const collisions = this.checkAllCollisions()

    // Handle collisions (update scores)
    if (collisions.length > 0) {
      this.handleCollisions(collisions)
    }

    // Broadcast game state
    this.broadcastState()

    // Clean up old collision cooldowns
    this.cleanupCollisionCooldowns()
  }

  /**
   * Extract client inputs from presence data
   */
  private getClientInputs(
    allPresence: Record<string, GamePresence>,
  ): Map<PeerID, ClientPresence> {
    const inputs = new Map<PeerID, ClientPresence>()

    for (const [peerId, presence] of Object.entries(allPresence)) {
      if (presence.type === "client") {
        inputs.set(peerId as PeerID, presence)
      }
    }

    return inputs
  }

  /**
   * Sync car list with connected clients
   */
  private syncCarsWithClients(clientInputs: Map<PeerID, ClientPresence>): void {
    // Add new cars for new clients
    for (const [peerId, presence] of clientInputs) {
      if (!this.cars.has(peerId)) {
        const existingCars = Array.from(this.cars.values())
        const spawn = getSpawnPosition(existingCars)

        this.cars.set(peerId, {
          x: spawn.x,
          y: spawn.y,
          vx: 0,
          vy: 0,
          rotation: Math.random() * Math.PI * 2,
          color: presence.color,
          name: presence.name,
          hitUntil: 0,
        })

        logger.info`New car spawned for ${peerId} at (${spawn.x}, ${spawn.y})`

        // Ensure player has a score entry
        this.ensurePlayerScore(peerId, presence.name, presence.color)
      } else {
        // Update car metadata if changed
        const car = this.cars.get(peerId)

        if (!car) {
          throw new Error(`car not found for peer ${peerId}`)
        }

        if (car.name !== presence.name || car.color !== presence.color) {
          car.name = presence.name
          car.color = presence.color
        }
      }
    }

    // Remove cars for disconnected clients
    for (const peerId of this.cars.keys()) {
      if (!clientInputs.has(peerId)) {
        this.cars.delete(peerId)
        logger.info`Car removed for disconnected ${peerId}`
      }
    }
  }

  /**
   * Check all car-to-car collisions
   */
  private checkAllCollisions(): Collision[] {
    const collisions: Collision[] = []
    const peerIds = Array.from(this.cars.keys())

    for (let i = 0; i < peerIds.length; i++) {
      for (let j = i + 1; j < peerIds.length; j++) {
        const peer1 = peerIds[i]
        const peer2 = peerIds[j]

        const car1 = this.cars.get(peer1)
        if (!car1) {
          throw new Error(`car1 not found for peer ${peer1}`)
        }

        const car2 = this.cars.get(peer2)
        if (!car2) {
          throw new Error(`car2 not found for peer ${peer2}`)
        }

        const collision = checkCarCollision(peer1, car1, peer2, car2)
        if (collision) {
          collisions.push(collision)
        }
      }
    }

    return collisions
  }

  /**
   * Handle collisions - update scores only for cars that hit with their front
   */
  private handleCollisions(collisions: Collision[]): void {
    for (const collision of collisions) {
      // Skip if no one scored (e.g., side-to-side collision)
      if (collision.scorers.length === 0) {
        continue
      }

      // Create a unique key for this collision pair
      const key = [collision.peer1, collision.peer2].sort().join("-")

      // Check cooldown
      const lastCollision = this.recentCollisions.get(key)
      if (
        lastCollision &&
        Date.now() - lastCollision < this.COLLISION_COOLDOWN
      ) {
        continue
      }

      // Record collision time
      this.recentCollisions.set(key, collision.timestamp)

      // Determine victims (cars that were hit but didn't score)
      const victims = [collision.peer1, collision.peer2].filter(
        peer => !collision.scorers.includes(peer),
      )

      // Set hit effect on victim cars
      const hitUntil = Date.now() + HIT_EFFECT_DURATION
      for (const victim of victims) {
        const car = this.cars.get(victim)
        if (car) {
          car.hitUntil = hitUntil
        }
      }

      // Update scores only for cars that hit with their front
      for (const scorer of collision.scorers) {
        this.incrementScore(scorer)
        logger.debug`${scorer} scored a bump!`
      }

      logger.debug`Collision between ${collision.peer1} and ${collision.peer2}, scorers: ${collision.scorers.join(", ")}`
    }
  }

  /**
   * Ensure a player has a score entry in the document
   */
  private ensurePlayerScore(peerId: PeerID, name: string, color: string): void {
    // Use TypedDoc for schema-aware mutations
    const typedDoc = createTypedDoc(ArenaSchema, EmptyArena, this.handle.doc)
    typedDoc.change((draft: Draft<typeof ArenaSchema>) => {
      if (!draft.scores.has(peerId)) {
        // For records with container values, we need to access the nested container
        // via get() which creates it, then modify its properties
        const score = draft.scores.get(peerId)
        score.name = name
        score.color = color
        // Counter starts at 0 by default, no need to set
      }
    })
  }

  /**
   * Increment a player's bump score
   */
  private incrementScore(peerId: PeerID): void {
    // Use TypedDoc for schema-aware mutations
    const typedDoc = createTypedDoc(ArenaSchema, EmptyArena, this.handle.doc)
    typedDoc.change((draft: Draft<typeof ArenaSchema>) => {
      const score = draft.scores.get(peerId)
      if (score) {
        score.bumps.increment(1)
      }
    })
  }

  /**
   * Broadcast current game state via presence
   */
  private broadcastState(): void {
    const carsRecord: Record<PeerID, CarState> = {}
    for (const [peerId, car] of this.cars) {
      carsRecord[peerId] = { ...car }
    }

    this.setPresence({
      type: "server",
      cars: carsRecord,
      tick: this.tick,
    })
  }

  /**
   * Clean up old collision cooldowns
   */
  private cleanupCollisionCooldowns(): void {
    const now = Date.now()
    for (const [key, timestamp] of this.recentCollisions) {
      if (now - timestamp > this.COLLISION_COOLDOWN * 2) {
        this.recentCollisions.delete(key)
      }
    }
  }
}
