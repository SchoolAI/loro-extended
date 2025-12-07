import { Repo, type RepoParams } from "@loro-extended/repo"
import { type ReactNode, useEffect, useMemo } from "react"
import { RepoContext } from "./hooks-core.js"

export const RepoProvider = ({
  config,
  children,
}: {
  config: RepoParams
  children: ReactNode
}) => {
  const repo = useMemo(() => new Repo(config), [config])

  // Proper cleanup when component unmounts
  useEffect(() => {
    return () => {
      // Clean up resources when RepoProvider unmounts
      repo.reset()
    }
  }, [repo])

  return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
}

export { useRepo } from "./hooks-core.js"
