import { Repo, type RepoConfig } from "@loro-extended/repo"
import { createContext, type ReactNode, useContext, useMemo } from "react"

const RepoContext = createContext<Repo | null>(null)

export const RepoProvider = ({
  config,
  children,
}: {
  config: RepoConfig
  children: ReactNode
}) => {
  const repo = useMemo(() => new Repo(config), [config])

  return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
}

export const useRepo = () => {
  const repo = useContext(RepoContext)
  if (!repo) {
    throw new Error("useRepo must be used within a RepoProvider")
  }
  return repo
}
