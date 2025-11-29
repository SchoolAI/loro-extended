/**
 * Banner shown when the user loses connection to the server.
 */
export function OfflineBanner() {
  return (
    <div className="bg-yellow-500 text-yellow-900 px-4 py-2 text-center text-sm font-medium">
      <span className="mr-2">⚠️</span>
      You're offline. Trying to reconnect...
    </div>
  )
}
