import { homeRoute } from "../../shared/view-schema.js"
import type { ViewDispatch } from "../browser-history-reactor.js"

// ═══════════════════════════════════════════════════════════════════════════
// Settings Page
// ═══════════════════════════════════════════════════════════════════════════
// Per-peer preferences (theme, sound, etc.)

export interface SettingsPageProps {
  viewDispatch: ViewDispatch
}

export function SettingsPage({ viewDispatch }: SettingsPageProps) {
  const handleBackToHome = () => {
    viewDispatch({
      type: "NAVIGATE",
      route: homeRoute(),
      currentScrollY: window.scrollY,
    })
  }

  // TODO: Wire up to View Doc preferences
  // For now, just show placeholder UI

  return (
    <div className="settings-page">
      <div className="page-nav">
        <button type="button" className="back-btn" onClick={handleBackToHome}>
          ← Back to Home
        </button>
      </div>

      <div className="settings-card">
        <h2>⚙️ Settings</h2>

        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="setting-row">
            <label htmlFor="theme-select">Theme</label>
            <select id="theme-select" disabled>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        <div className="settings-section">
          <h3>Quiz Options</h3>
          <div className="setting-row">
            <label htmlFor="sound-toggle">Sound Effects</label>
            <input type="checkbox" id="sound-toggle" disabled defaultChecked />
          </div>
          <div className="setting-row">
            <label htmlFor="timer-toggle">Show Timer</label>
            <input type="checkbox" id="timer-toggle" disabled defaultChecked />
          </div>
        </div>

        <p className="settings-note">
          Settings are stored locally and don't sync between devices.
        </p>
      </div>
    </div>
  )
}
