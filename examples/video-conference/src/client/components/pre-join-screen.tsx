import { useState } from "react"
import type { DeviceSelectionProps } from "../use-local-media"
import { AudioLevelMeter } from "./audio-level-meter"
import { DeviceSelectorGroup } from "./device-selector"
import { CameraIcon, MicIcon } from "./icons"
import { VideoBubble } from "./video-bubble"

export type PreJoinScreenProps = {
  localStream: MediaStream | null
  displayName: string
  hasAudio: boolean
  hasVideo: boolean
  mediaError: Error | null
  mediaLoading: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onRequestMedia: () => void
  onJoin: () => void
  canJoin: boolean
  /** Device selection state and callbacks */
  deviceSelection: DeviceSelectionProps
  /** Audio level from 0-100 */
  audioLevel: number
}

export function PreJoinScreen({
  localStream,
  displayName,
  hasAudio,
  hasVideo,
  mediaError,
  mediaLoading,
  onToggleAudio,
  onToggleVideo,
  onRequestMedia,
  onJoin,
  canJoin,
  deviceSelection,
  audioLevel,
}: PreJoinScreenProps) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Ready to join?</h2>

      {/* Local video preview */}
      <div className="relative">
        <VideoBubble
          stream={localStream}
          label={displayName}
          muted={true}
          isLocal={true}
          hasAudio={hasAudio}
          hasVideo={hasVideo}
        />
      </div>

      {/* Audio level indicator */}
      <div className="w-full max-w-xs">
        <AudioLevelMeter level={audioLevel} isActive={hasAudio} />
      </div>

      {/* Status message area - fixed height to prevent layout shift */}
      <div className="h-8 flex items-center justify-center">
        {mediaError && (
          <div className="bg-red-100 text-red-700 px-4 py-1 rounded-lg text-sm">
            Camera/microphone error: {mediaError.message}
            <button
              type="button"
              onClick={onRequestMedia}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}
        {!mediaError && mediaLoading && (
          <div className="text-gray-500 text-sm">
            Requesting camera and microphone...
          </div>
        )}
      </div>

      {/* Media controls */}
      <div className="flex gap-4 items-center">
        <button
          type="button"
          onClick={onToggleAudio}
          className={`p-3 rounded-full transition-colors ${
            hasAudio
              ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
          title={hasAudio ? "Mute" : "Unmute"}
        >
          <MicIcon disabled={!hasAudio} />
        </button>
        <button
          type="button"
          onClick={onToggleVideo}
          className={`p-3 rounded-full transition-colors ${
            hasVideo
              ? "bg-gray-200 hover:bg-gray-300 text-gray-700"
              : "bg-red-500 text-white hover:bg-red-600"
          }`}
          title={hasVideo ? "Turn off camera" : "Turn on camera"}
        >
          <CameraIcon disabled={!hasVideo} />
        </button>

        {/* Settings toggle button */}
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className={`p-3 rounded-full transition-colors ${
            showSettings
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-gray-200 hover:bg-gray-300 text-gray-700"
          }`}
          title="Device settings"
        >
          <SettingsIcon />
        </button>
      </div>

      {/* Device settings panel */}
      {showSettings && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-lg">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Device Settings
          </h3>
          <DeviceSelectorGroup
            audioInputs={deviceSelection.audioInputs}
            audioOutputs={deviceSelection.audioOutputs}
            videoInputs={deviceSelection.videoInputs}
            selectedAudioInput={deviceSelection.selectedAudioInput}
            selectedAudioOutput={deviceSelection.selectedAudioOutput}
            selectedVideoInput={deviceSelection.selectedVideoInput}
            onAudioInputChange={deviceSelection.onAudioInputChange}
            onAudioOutputChange={deviceSelection.onAudioOutputChange}
            onVideoInputChange={deviceSelection.onVideoInputChange}
            isAudioOutputSupported={deviceSelection.isAudioOutputSupported}
            disabled={mediaLoading}
          />
        </div>
      )}

      {/* Join button */}
      <button
        type="button"
        onClick={onJoin}
        disabled={!canJoin}
        className="bg-green-600 hover:bg-green-500 disabled:bg-gray-300 text-white px-8 py-3 rounded-full text-lg font-medium transition-colors shadow-lg"
      >
        Join Room
      </button>

      <p className="text-gray-500 text-sm">
        Share this link with others to invite them
      </p>
    </div>
  )
}

/**
 * Settings/gear icon
 */
function SettingsIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <title>Settings</title>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  )
}
