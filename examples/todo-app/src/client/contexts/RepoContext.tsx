import { createContext, useContext, type ReactNode } from "react";
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "../SseClientNetworkAdapter";
import { IndexedDBStorageAdapter } from "../IndexedDBStorageAdapter";

// Create the Repo instance so it's a singleton.
const network = new SseClientNetworkAdapter("/loro");
const storage = new IndexedDBStorageAdapter();
const repo = new Repo({ network: [network], storage });

const RepoContext = createContext<Repo | null>(null);

export const RepoProvider = ({ children }: { children: ReactNode }) => {
  return (
    <RepoContext.Provider value={repo}>
      {children}
    </RepoContext.Provider>
  )
};

export const useRepo = () => {
  const repo = useContext(RepoContext);
  if (!repo) {
    throw new Error("useRepo must be used within a RepoProvider");
  }
  return repo;
};