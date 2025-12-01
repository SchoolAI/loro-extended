import { useEffect, useRef, useState } from "react"
import { CAR_COLORS, type CarColor } from "../../shared/types"

// Map color hex values to CSS class names
const COLOR_CLASS_MAP: Record<CarColor, string> = {
  "#FF6B6B": "color-red",
  "#FF9F43": "color-orange",
  "#FFEAA7": "color-yellow",
  "#26DE81": "color-green",
  "#4ECDC4": "color-teal",
  "#54A0FF": "color-blue",
  "#A55EEA": "color-purple",
  "#FFB8D0": "color-pink",
  "#2D3436": "color-charcoal",
  "#FFFFFF": "color-white",
}

type JoinScreenProps = {
  initialName: string
  initialColor: CarColor
  onJoin: (name: string, color: CarColor) => void
  canJoin: boolean
}

export function JoinScreen({
  initialName,
  initialColor,
  onJoin,
  canJoin,
}: JoinScreenProps) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<CarColor>(initialColor)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the name input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() && canJoin) {
      onJoin(name.trim(), color)
    }
  }

  return (
    <div className="join-screen">
      <h1>🎪 Bumper Cars Arena</h1>
      <p className="subtitle">Bump into other players to score points!</p>

      <form className="join-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="player-name">Your Name</label>
          <input
            ref={inputRef}
            id="player-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
          />
        </div>

        <div className="form-field">
          <span className="field-label">Car Color</span>
          <div
            className="color-picker"
            role="radiogroup"
            aria-label="Car color selection"
          >
            {CAR_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`color-option ${c === color ? "selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
                aria-label={`Select color ${c}`}
                aria-pressed={c === color}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          className={`join-button ${COLOR_CLASS_MAP[color]}`}
          disabled={!name.trim() || !canJoin}
        >
          {canJoin ? "🏎️ Join Arena" : "Connecting..."}
        </button>
      </form>
    </div>
  )
}
