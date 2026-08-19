import type { CanvasFrame } from "../canvas/types";
import { luminaStationDocument } from "./lumina-station";

export const demoDocument = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body {
        color: #171715;
        background: #f3f0e9;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .page { min-height: 100vh; padding: clamp(22px, 5vw, 68px); display: flex; flex-direction: column; }
      nav { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
      .mark { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.03em; }
      .dot { width: 11px; height: 11px; border-radius: 50%; background: #ff4d00; box-shadow: 12px 0 0 #171715; margin-right: 12px; }
      .nav-copy { color: #716e67; font-size: 13px; }
      main { flex: 1; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(220px, .6fr); align-items: end; gap: 5vw; padding: 13vh 0 5vh; }
      .eyebrow { color: #ff4d00; font-size: 12px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
      h1 { max-width: 900px; margin: 18px 0 0; font-size: clamp(58px, 8.6vw, 150px); line-height: .85; letter-spacing: -.075em; font-weight: 620; }
      .aside { align-self: end; border-top: 1px solid #b9b5ad; padding-top: 18px; }
      .aside p { margin: 0; max-width: 31ch; color: #5b5852; font-size: clamp(15px, 1.25vw, 19px); line-height: 1.5; }
      .meta { display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid #d3cfc6; padding-top: 16px; color: #716e67; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      @media (max-width: 720px) {
        .page { padding: 22px; }
        .nav-copy { display: none; }
        main { grid-template-columns: 1fr; align-content: end; gap: 42px; padding: 19vh 0 8vh; }
        h1 { font-size: clamp(58px, 20vw, 88px); }
        .aside { max-width: none; }
        .meta span:nth-child(2) { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <nav>
        <div class="mark"><span class="dot"></span>Fieldwork</div>
        <div class="nav-copy">A responsive HTML document</div>
      </nav>
      <main>
        <section>
          <div class="eyebrow">Independent thinking · 2026</div>
          <h1>Make room for better ideas.</h1>
        </section>
        <aside class="aside"><p>A quiet place for teams and agents to shape interfaces together—directly in the medium that ships.</p></aside>
      </main>
      <footer class="meta"><span>HTML / CSS</span><span>One document, many viewports</span><span>Scroll to explore</span></footer>
    </div>
  </body>
</html>`;

export const initialFrames: CanvasFrame[] = [
  {
    id: "desktop",
    name: "Desktop · 1440 × 900",
    documentId: "fieldwork",
    category: "desktop",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  },
  {
    id: "tablet",
    name: "Tablet · 820 × 1180",
    documentId: "fieldwork",
    category: "tablet",
    x: 1570,
    y: 0,
    width: 820,
    height: 1180,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  },
  {
    id: "mobile",
    name: "Mobile · 390 × 844",
    documentId: "fieldwork",
    category: "mobile",
    x: 2520,
    y: 0,
    width: 390,
    height: 844,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  },
  {
    id: "mobile-large",
    name: "Mobile · 430 × 932",
    documentId: "fieldwork",
    category: "mobile",
    x: 3040,
    y: 0,
    width: 430,
    height: 932,
    srcDoc: demoDocument,
    background: "#f3f0e9",
  },
  {
    id: "lumina-desktop",
    name: "Lumina Station · Desktop · 1440 × 900",
    documentId: "lumina-station",
    category: "desktop",
    pageId: "lumina-page",
    pageName: "Lumina Station",
    x: 0,
    y: 1400,
    width: 1440,
    height: 900,
    srcDoc: luminaStationDocument,
    background: "#f3f1ed",
  },
];
