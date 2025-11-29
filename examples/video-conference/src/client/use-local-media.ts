import { useCallback, useEffect, useRef, useState } from "react"

export type MediaState = {
  stream: MediaStream | null
  error: Error | null
  isLoading: boolean
  isMediaReady: boolean
  hasAudio: boolean
  hasVideo: boolean
}

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

  const requestMedia = useCallback(async () => {
    // Prevent duplicate requests
    if (hasRequestedRef.current && state.stream) {
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: wantsAudio,
        video: wantsVideo
          ? {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: "user",
            }
          : false,
      })

      hasRequestedRef.current = true

      // Set initial track enabled state based on user preferences
      stream.getAudioTracks().forEach(track => {
        track.enabled = wantsAudio
      })
      stream.getVideoTracks().forEach(track => {
        track.enabled = wantsVideo
      })

      setState({
        stream,
        error: null,
        isLoading: false,
        isMediaReady: true,
        hasAudio: stream.getAudioTracks().some(t => t.enabled),
        hasVideo: stream.getVideoTracks().some(t => t.enabled),
      })
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err : new Error(String(err)),
        isLoading: false,
        isMediaReady: false,
      }))
    }
  }, [wantsAudio, wantsVideo, state.stream])

  // Auto-request media on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run on mount/unmount
  useEffect(() => {
    requestMedia()

    // Cleanup: stop all tracks when unmounting
    return () => {
      setState(prev => {
        if (prev.stream) {
          for (const track of prev.stream.getTracks()) {
            track.stop()
          }
        }
        return { ...prev, stream: null, isMediaReady: false }
      })
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
    requestMedia,
    toggleAudio,
    toggleVideo,
  }
}
