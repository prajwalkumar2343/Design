import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ensureCanvasFonts } from "./fonts";
import { installHistorySwipeGuard } from "./interaction/history-swipe";
import { installPageZoomGuard } from "./interaction/page-zoom";
import "./styles.css";

installHistorySwipeGuard();
installPageZoomGuard();
ensureCanvasFonts(document);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
