import { useCallback, useEffect, useRef, useState } from "react"
import { useAudioLevel, useMediaDevices } from "./hooks"

export type MediaState = {
  stream: MediaStream | null
  error: Error | null
  isLoading: boolean
  isMediaReady: boolean
  hasAudio: boolean
  hasVideo: boolean
}

/**
 * Device selection state - available devices and current selections.
 * This type groups all device-related properties for easier passing between components.
 */
export type DeviceSelectionState = {
  /** Available audio input devices (microphones) */
  audioInputs: MediaDeviceInfo[]
  /** Available audio output devices (speakers) */
  audioOutputs: MediaDeviceInfo[]
  /** Available video input devices (cameras) */
  videoInputs: MediaDeviceInfo[]
  /** Currently selected audio input device ID */
  selectedAudioInput: string | null
  /** Currently selected audio output device ID */
  selectedAudioOutput: string | null
  /** Currently selected video input device ID */
  selectedVideoInput: string | null
  /** Whether audio output selection is supported (not available in Safari) */
  isAudioOutputSupported: boolean
}

/**
 * Device selection callbacks - functions to change device selections.
 */
export type DeviceSelectionCallbacks = {
  /** Change the audio input device (microphone) */
  onAudioInputChange: (deviceId: string) => void
  /** Change the audio output device (speaker) */
  onAudioOutputChange: (deviceId: string) => void
  /** Change the video input device (camera) */
  onVideoInputChange: (deviceId: string) => void
}

/**
 * Combined device selection props - state and callbacks together.
 * Use this type when passing device selection to components.
 */
export type DeviceSelectionProps = DeviceSelectionState &
  DeviceSelectionCallbacks

export type UseLocalMediaReturn = {
  // User preferences (immediately toggleable, even before gUM)
  wantsAudio: boolean
  wantsVideo: boolean
  setWantsAudio: (value: boolean) => void
  setWantsVideo: (value: boolean) => void

  // Actual media state (after gUM)
  stream: MediaStream | null
  hasAudio: boolean
  hasVideo: boolean

  // Status
  isMediaReady: boolean
  isLoading: boolean
  error: Error | null

  // Actions
  requestMedia: () => Promise<void>
  toggleAudio: () => void
  toggleVideo: () => void

  // Device selection (grouped)
  deviceSelection: DeviceSelectionProps

  // Audio level monitoring
  audioLevel: number
}

/**
 * Hook to manage local media (camera and microphone).
 *
 * Key features:
 * - User can toggle audio/video preferences BEFORE getUserMedia is called
 * - Controls are immediately responsive
 * - Join button should be disabled until isMediaReady is true
 * - Once media is ready, track enabled state syncs with user preferences
 */
export function useLocalMedia(
  initialWantsAudio: boolean = true,
  initialWantsVideo: boolean = true,
): UseLocalMediaReturn {
  // User preferences - immediately toggleable
  const [wantsAudio, setWantsAudio] = useState(initialWantsAudio)
  const [wantsVideo, setWantsVideo] = useState(initialWantsVideo)

  // Device selection state
  const [selectedAudioInput, setSelectedAudioInput] = useState<string | null>(
    null,
  )
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string | null>(
    null,
  )
  const [selectedVideoInput, setSelectedVideoInput] = useState<string | null>(
    null,
  )

  // Actual media state
  const [state, setState] = useState<MediaState>({
    stream: null,
    error: null,
    isLoading: false,
    isMediaReady: false,
    hasAudio: false,
    hasVideo: false,
  })

  // Track if we've already requested media
  const hasRequestedRef = useRef(false)

  // Store stream in a ref for cleanup access
  // This ensures we can stop tracks even after unmount
  const streamRef = useRef<MediaStream | null>(null)

  // Use media devices hook for enumeration
  const { devices, refreshDevices, isAudioOutputSupported } = useMediaDevices()

  // Use audio level hook for monitoring
  const { audioLevel } = useAudioLevel(state.stream, wantsAudio)

  // Build constraints based on selected devices
  const buildConstraints = useCallback(
    (audioDeviceId: string | null, videoDeviceId: string | null) => {
      const audioConstraints: MediaTrackConstraints | boolean = audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : true

      const videoConstraints: MediaTrackConstraints | boolean = videoDeviceId
        ? {
            deviceId: { exact: videoDeviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          }
        : {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          }

      return {
        audio: wantsAudio ? audioConstraints : false,
        video: wantsVideo ? videoConstraints : false,
      }
    },
    [wantsAudio, wantsVideo],
  )

  const requestMedia = useCallback(
    async (audioDeviceId?: string | null, videoDeviceId?: string | null) => {
      // Use provided device IDs or fall back to current selection
      const audioId =
        audioDeviceId !== undefined ? audioDeviceId : selectedAudioInput
      const videoId =
        videoDeviceId !== undefined ? videoDeviceId : selectedVideoInput

      // Prevent duplicate requests with same devices
      if (
        hasRequestedRef.current &&
        state.stream &&
        audioDeviceId === undefined &&
        videoDeviceId === undefined
      ) {
        return
      }

      setState(prev => ({ ...prev, isLoading: true, error: null }))

      // Stop existing tracks before getting new ones
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop()
        }
      }

      try {
        const constraints = buildConstraints(audioId, videoId)
        const stream = await navigator.mediaDevices.getUserMedia(constraints)

        hasRequestedRef.current = true

        // Set initial track enabled state based on user preferences
        for (const track of stream.getAudioTracks()) {
          track.enabled = wantsAudio
        }
        for (const track of stream.getVideoTracks()) {
          track.enabled = wantsVideo
        }

        // Store in ref for cleanup
        streamRef.current = stream

        // Update selected device IDs based on actual tracks
        const audioTrack = stream.getAudioTracks()[0]
        const videoTrack = stream.getVideoTracks()[0]

        if (audioTrack) {
          const settings = audioTrack.getSettings()
          if (settings.deviceId) {
            setSelectedAudioInput(settings.deviceId)
          }
        }

        if (videoTrack) {
          const settings = videoTrack.getSettings()
          if (settings.deviceId) {
            setSelectedVideoInput(settings.deviceId)
          }
        }

        setState({
          stream,
          error: null,
          isLoading: false,
          isMediaReady: true,
          hasAudio: stream.getAudioTracks().some(t => t.enabled),
          hasVideo: stream.getVideoTracks().some(t => t.enabled),
        })

        // Refresh device list to get labels (now that we have permission)
        refreshDevices()
      } catch (err) {
        setState(prev => ({
          ...prev,
          error: err instanceof Error ? err : new Error(String(err)),
          isLoading: false,
          isMediaReady: false,
        }))
      }
    },
    [
      selectedAudioInput,
      selectedVideoInput,
      state.stream,
      buildConstraints,
      wantsAudio,
      wantsVideo,
      refreshDevices,
    ],
  )

  // Auto-request media on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run on mount/unmount
  useEffect(() => {
    requestMedia()

    // Cleanup: stop all tracks when unmounting
    // Use ref to access stream directly (not via setState callback)
    // This ensures cleanup runs synchronously on unmount
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop()
        }
        streamRef.current = null
      }
    }
  }, [])

  // Sync track enabled state with user preferences when stream is available
  useEffect(() => {
    if (state.stream) {
      state.stream.getAudioTracks().forEach(track => {
        track.enabled = wantsAudio
      })
      setState(prev => ({
        ...prev,
        hasAudio: state.stream?.getAudioTracks().some(t => t.enabled) ?? false,
      }))
    }
  }, [wantsAudio, state.stream])

  useEffect(() => {
    if (state.stream) {
      state.stream.getVideoTracks().forEach(track => {
        track.enabled = wantsVideo
      })
      setState(prev => ({
        ...prev,
        hasVideo: state.stream?.getVideoTracks().some(t => t.enabled) ?? false,
      }))
    }
  }, [wantsVideo, state.stream])

  // Toggle functions that work both before and after gUM
  const toggleAudio = useCallback(() => {
    setWantsAudio(prev => !prev)
  }, [])

  const toggleVideo = useCallback(() => {
    setWantsVideo(prev => !prev)
  }, [])

  // Device selection functions
  const setAudioInput = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInput(deviceId)
      if (state.isMediaReady) {
        await requestMedia(deviceId, selectedVideoInput)
      }
    },
    [state.isMediaReady, requestMedia, selectedVideoInput],
  )

  const setVideoInput = useCallback(
    async (deviceId: string) => {
      setSelectedVideoInput(deviceId)
      if (state.isMediaReady) {
        await requestMedia(selectedAudioInput, deviceId)
      }
    },
    [state.isMediaReady, requestMedia, selectedAudioInput],
  )

  const setAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutput(deviceId)
    // Note: Audio output is set on the HTMLMediaElement via setSinkId,
    // not on the stream. The component using this hook should handle
    // setting the audio output on video/audio elements.
  }, [])

  return {
    // User preferences
    wantsAudio,
    wantsVideo,
    setWantsAudio,
    setWantsVideo,

    // Actual media state
    stream: state.stream,
    hasAudio: state.hasAudio,
    hasVideo: state.hasVideo,

    // Status
    isMediaReady: state.isMediaReady,
    isLoading: state.isLoading,
    error: state.error,

    // Actions
    requestMedia: () => requestMedia(),
    toggleAudio,
    toggleVideo,

    // Device selection (grouped)
    deviceSelection: {
      audioInputs: devices.audioInputs,
      audioOutputs: devices.audioOutputs,
      videoInputs: devices.videoInputs,
      selectedAudioInput,
      selectedAudioOutput,
      selectedVideoInput,
      isAudioOutputSupported,
      onAudioInputChange: setAudioInput,
      onAudioOutputChange: setAudioOutput,
      onVideoInputChange: setVideoInput,
    },

    // Audio level monitoring
    audioLevel,
  }
}
