import { useCallback, useEffect, useState } from "react"

export type MediaDevices = {
  audioInputs: MediaDeviceInfo[]
  audioOutputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
}

export type UseMediaDevicesReturn = {
  devices: MediaDevices
  isLoading: boolean
  error: Error | null
  refreshDevices: () => Promise<void>
  isAudioOutputSupported: boolean
}

/**
 * Hook to enumerate and monitor available media devices.
 *
 * Note: Device labels are only available after getUserMedia permission is granted.
 * Before permission, labels will be empty strings.
 */
export function useMediaDevices(): UseMediaDevicesReturn {
  const [devices, setDevices] = useState<MediaDevices>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Check if setSinkId is supported (for audio output selection)
  const isAudioOutputSupported =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype

  const refreshDevices = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const allDevices = await navigator.mediaDevices.enumerateDevices()

      setDevices({
        audioInputs: allDevices.filter(d => d.kind === "audioinput"),
        audioOutputs: allDevices.filter(d => d.kind === "audiooutput"),
        videoInputs: allDevices.filter(d => d.kind === "videoinput"),
      })
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial enumeration
  useEffect(() => {
    refreshDevices()
  }, [refreshDevices])

  // Listen for device changes (plug/unplug)
  useEffect(() => {
    const handleDeviceChange = () => {
      refreshDevices()
    }

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      )
    }
  }, [refreshDevices])

  return {
    devices,
    isLoading,
    error,
    refreshDevices,
    isAudioOutputSupported,
  }
}
