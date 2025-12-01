import type { PeerID } from "@loro-extended/repo"

type ScoreEntry = {
  peerId: PeerID
  name: string
  color: string
  bumps: number
}

type ScoreboardProps = {
  scores: ScoreEntry[]
}

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]

export function Scoreboard({ scores }: ScoreboardProps) {
  if (scores.length === 0) {
    return (
      <div className="scoreboard">
        <span style={{ color: "#888" }}>
          No scores yet - bump into other cars!
        </span>
      </div>
    )
  }

  return (
    <div className="scoreboard">
      {scores.map((score, index) => (
        <div key={score.peerId} className="scoreboard-item">
          <span className="scoreboard-medal">{MEDALS[index] || "🏎️"}</span>
          <span className="scoreboard-name" style={{ color: score.color }}>
            {score.name}
          </span>
          <span className="scoreboard-bumps">{score.bumps}</span>
        </div>
      ))}
    </div>
  )
}
