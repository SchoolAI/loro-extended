import { type ReactNode, useId } from "react"
import type { DeviceSelectionProps } from "../use-local-media"
import { CameraIcon, MicIcon, SpeakerIcon } from "./icons"

export type DeviceSelectorProps = {
  /** Label for the selector */
  label: string
  /** List of available devices */
  devices: MediaDeviceInfo[]
  /** Currently selected device ID */
  selectedId: string | null
  /** Callback when device selection changes */
  onChange: (deviceId: string) => void
  /** Whether the selector is disabled */
  disabled?: boolean
  /** Optional icon to display */
  icon?: ReactNode
  /** Placeholder text when no device is selected */
  placeholder?: string
}

/**
 * Dropdown selector for media devices (microphone, camera, speaker).
 */
export function DeviceSelector({
  label,
  devices,
  selectedId,
  onChange,
  disabled = false,
  icon,
  placeholder = "Select device",
}: DeviceSelectorProps) {
  // Get device label, falling back to a generic name if label is empty
  const getDeviceLabel = (device: MediaDeviceInfo, index: number): string => {
    if (device.label) {
      return device.label
    }
    // Labels are empty before getUserMedia permission is granted
    return `${label} ${index + 1}`
  }

  const selectId = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="text-sm font-medium text-gray-700 flex items-center gap-2"
      >
        {icon}
        {label}
      </label>
      <select
        id={selectId}
        value={selectedId ?? ""}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || devices.length === 0}
        className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm
                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed
                   appearance-none cursor-pointer"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: "right 0.5rem center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "1.5em 1.5em",
          paddingRight: "2.5rem",
        }}
      >
        {devices.length === 0 ? (
          <option value="">{placeholder}</option>
        ) : (
          devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {getDeviceLabel(device, index)}
            </option>
          ))
        )}
      </select>
    </div>
  )
}

/**
 * Props for DeviceSelectorGroup - extends DeviceSelectionProps with disabled state.
 * DeviceSelectionProps comes from use-local-media and contains all device state and callbacks.
 */
export type DeviceSelectorGroupProps = DeviceSelectionProps & {
  /** Whether the selectors are disabled */
  disabled?: boolean
}

/**
 * Group of device selectors for microphone, speaker, and camera.
 */
export function DeviceSelectorGroup({
  audioInputs,
  audioOutputs,
  videoInputs,
  selectedAudioInput,
  selectedAudioOutput,
  selectedVideoInput,
  onAudioInputChange,
  onAudioOutputChange,
  onVideoInputChange,
  isAudioOutputSupported,
  disabled = false,
}: DeviceSelectorGroupProps) {
  return (
    <div className="flex flex-col gap-4 w-full max-w-xs">
      <DeviceSelector
        label="Microphone"
        devices={audioInputs}
        selectedId={selectedAudioInput}
        onChange={onAudioInputChange}
        disabled={disabled}
        icon={<MicIcon className="w-4 h-4" />}
        placeholder="No microphone found"
      />

      <DeviceSelector
        label="Camera"
        devices={videoInputs}
        selectedId={selectedVideoInput}
        onChange={onVideoInputChange}
        disabled={disabled}
        icon={<CameraIcon className="w-4 h-4" />}
        placeholder="No camera found"
      />

      {isAudioOutputSupported ? (
        <DeviceSelector
          label="Speaker"
          devices={audioOutputs}
          selectedId={selectedAudioOutput}
          onChange={onAudioOutputChange}
          disabled={disabled}
          icon={<SpeakerIcon className="w-4 h-4" />}
          placeholder="No speaker found"
        />
      ) : (
        <div className="text-xs text-gray-500 italic">
          Speaker selection is not supported in this browser
        </div>
      )}
    </div>
  )
}
