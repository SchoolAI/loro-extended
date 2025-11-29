import { useCallback, useEffect, useState } from "react"

export type MediaState = {
  stream: MediaStream | null
  error: Error | null
  isLoading: boolean
  hasAudio: boolean
  hasVideo: boolean
}

export type UseLocalMediaReturn = {
  stream: MediaStream | null
  error: Error | null
  isLoading: boolean
  hasAudio: boolean
  hasVideo: boolean
  toggleAudio: () => void
  toggleVideo: () => void
  requestMedia: () => Promise<void>
}

/**
 * Hook to manage local media (camera and microphone)
 */
export function useLocalMedia(
  wantsAudio: boolean = true,
  wantsVideo: boolean = true,
): UseLocalMediaReturn {
  const [state, setState] = useState<MediaState>({
    stream: null,
    error: null,
    isLoading: false,
    hasAudio: false,
    hasVideo: false,
  })

  const requestMedia = useCallback(async () => {
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

      setState({
        stream,
        error: null,
        isLoading: false,
        hasAudio: stream.getAudioTracks().length > 0,
        hasVideo: stream.getVideoTracks().length > 0,
      })
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err : new Error(String(err)),
        isLoading: false,
      }))
    }
  }, [wantsAudio, wantsVideo])

  // Request media on mount
  useEffect(() => {
    requestMedia()

    // Cleanup: stop all tracks when unmounting
    return () => {
      setState(prev => {
        if (prev.stream) {
          prev.stream.getTracks().forEach(track => track.stop())
        }
        return { ...prev, stream: null }
      })
    }
  }, [requestMedia])

  const toggleAudio = useCallback(() => {
    if (state.stream) {
      state.stream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setState(prev => ({
        ...prev,
        hasAudio: state.stream?.getAudioTracks().some(t => t.enabled) ?? false,
      }))
    }
  }, [state.stream])

  const toggleVideo = useCallback(() => {
    if (state.stream) {
      state.stream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setState(prev => ({
        ...prev,
        hasVideo: state.stream?.getVideoTracks().some(t => t.enabled) ?? false,
      }))
    }
  }, [state.stream])

  return {
    stream: state.stream,
    error: state.error,
    isLoading: state.isLoading,
    hasAudio: state.hasAudio,
    hasVideo: state.hasVideo,
    toggleAudio,
    toggleVideo,
    requestMedia,
  }
}