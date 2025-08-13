import { Repo, type RepoConfig } from "@loro-extended/repo"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react"

const RepoContext = createContext<Repo | null>(null)

export const RepoProvider = ({
  config,
  children,
}: {
  config: RepoConfig
  children: ReactNode
}) => {
  const repo = useMemo(() => new Repo(config), [config])

  // Proper cleanup when component unmounts
  useEffect(() => {
    return () => {
      // Disconnect all network adapters and clean up resources when RepoProvider unmounts
      repo.disconnect()
    }
  }, [repo])

  return <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
}

export const useRepo = () => {
  const repo = useContext(RepoContext)
  if (!repo) {
    throw new Error("useRepo must be used within a RepoProvider")
  }
  return repo
}
