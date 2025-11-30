export type AudioLevelMeterProps = {
  /** Audio level from 0-100 */
  level: number
  /** Whether the microphone is active (not muted) */
  isActive: boolean
  /** Number of bars to display */
  barCount?: number
}

/**
 * Visual audio level meter component.
 * Shows a series of bars that light up based on the audio level.
 */
export function AudioLevelMeter({
  level,
  isActive,
  barCount = 10,
}: AudioLevelMeterProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-end gap-0.5 h-6">
        {[...Array(barCount)].map((_, i) => {
          const threshold = (i / barCount) * 100
          const isLit = isActive && level > threshold

          // Color gradient: green for low, yellow for medium, red for high
          let colorClass = "bg-gray-300"
          if (isLit) {
            if (i < barCount * 0.6) {
              colorClass = "bg-green-500"
            } else if (i < barCount * 0.8) {
              colorClass = "bg-yellow-500"
            } else {
              colorClass = "bg-red-500"
            }
          }

          // Bars get progressively taller
          const heightPercent = 40 + (i / barCount) * 60

          const key = `bar-${i}`

          return (
            <div
              key={key}
              className={`w-1.5 rounded-sm transition-colors duration-75 ${colorClass}`}
              style={{ height: `${heightPercent}%` }}
            />
          )
        })}
      </div>
      <span className="text-xs text-gray-500">
        {isActive ? "Microphone active" : "Microphone muted"}
      </span>
    </div>
  )
}
