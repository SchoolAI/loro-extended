import { Repo, type RepoParams } from "@loro-extended/repo"
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

export const useRepo = () => {
  const repo = useContext(RepoContext)
  if (!repo) {
    throw new Error("useRepo must be used within a RepoProvider")
  }
  return repo
}
