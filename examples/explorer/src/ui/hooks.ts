import { useApp, useInput } from "ink"

export function useQuitOnQ() {
  const { exit } = useApp()

  useInput(input => {
    if (input === "q") {
      exit()
    }
  })
}
