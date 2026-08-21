import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installHistorySwipeGuard } from "./interaction/history-swipe";
import "./styles.css";

installHistorySwipeGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
