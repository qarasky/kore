import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KoreProvider } from "@qarasky/kore-ui";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KoreProvider>
      <App />
    </KoreProvider>
  </StrictMode>,
);
