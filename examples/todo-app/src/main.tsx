import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "./index.css";
import App from "./client/App.tsx";
import { RepoProvider } from "./client/contexts/RepoContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RepoProvider>
      <App />
    </RepoProvider>
  </StrictMode>,
);
