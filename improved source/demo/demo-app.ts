/**
 * Live demo: the exact scenario from the product brief.
 *
 * The sidebar initially ignores hover — only the tiny tab button opens it.
 * Sweep the pointer quickly to the right edge twice and:
 *   tracker → ghost-gesture signal → RuleAdvisor proposal → policy gate →
 *   auto-applied `panel-open-on-hover-intent` → sidebar now opens on approach.
 * A `ui-state-change` event resolves future attempts, so the signal stops
 * firing once the fix is in. Reload to see persistence.
 *
 * Run with the parent project's Vite (it transpiles the TS imports):
 *   ../node_modules/.bin/vite ./demo --port 5199
 */

import {
  startSelfImprovement,
  type Adaptation,
  type FrustrationSignal,
} from "../src/index.ts";

const SIDEBAR_FEATURE = "left-sidebar";

/* ------------------------------------------------------------------ */
/* Host app state that adaptations may change                          */
/* ------------------------------------------------------------------ */

const appFlags = {
  openSidebarOnHoverIntent: false,
  enlargeSidebarTab: false,
};

async function applyAdaptationInApp(adaptation: Adaptation): Promise<boolean> {
  switch (adaptation.kind) {
    case "panel-open-on-hover-intent":
      appFlags.openSidebarOnHoverIntent = true;
      wireHoverIntent(adaptation.params.hoverDelayMs as number);
      log("fix applied", `${SIDEBAR_FEATURE}: opens on hover-intent`, true);
      return true;
    case "increase-hit-target":
      appFlags.enlargeSidebarTab = true;
      document.getElementById("sidebar-tab")!.style.width = "44px";
      log("fix applied", `${SIDEBAR_FEATURE}: larger hit target`, true);
      return true;
    default:
      return false; // unknown in this demo → stays a suggestion
  }
}

async function revertAdaptationInApp(adaptation: Adaptation): Promise<boolean> {
  if (adaptation.kind === "panel-open-on-hover-intent") {
    appFlags.openSidebarOnHoverIntent = false;
    unwireHoverIntent();
    log("rolled back", `${SIDEBAR_FEATURE}: hover-intent removed after regression`, true);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

const sidebar = document.getElementById("sidebar")!;
let sidebarOpen = false;

function setSidebar(open: boolean): void {
  if (open === sidebarOpen) return;
  sidebarOpen = open;
  sidebar.classList.toggle("open", open);
  document.getElementById("sidebar-tab")!.textContent = open ? "›" : "‹";
  // This event is what tells the ghost-gesture detector the intent was answered.
  loop.tracker.trackUiState(SIDEBAR_FEATURE, "open", String(!open), String(open));
}

document.getElementById("sidebar-tab")!.addEventListener("click", () => setSidebar(!sidebarOpen));

let hoverWiring: { enter: EventListener; timer: number | null } | null = null;

function wireHoverIntent(hoverDelayMs: number): void {
  if (hoverWiring) unwireHoverIntent();
  const onMove = (event: Event): void => {
    const { clientX } = event as PointerEvent;
    const nearEdge = window.innerWidth - clientX < 120;
    if (
      nearEdge &&
      appFlags.openSidebarOnHoverIntent &&
      !sidebarOpen &&
      hoverWiring?.timer === null
    ) {
      hoverWiring.timer = window.setTimeout(() => {
        hoverWiring && (hoverWiring.timer = null);
        setSidebar(true);
      }, hoverDelayMs);
    } else if (!nearEdge && hoverWiring?.timer !== null && hoverWiring?.timer !== undefined) {
      clearTimeout(hoverWiring.timer);
      hoverWiring.timer = null;
    }
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  hoverWiring = { enter: onMove, timer: null };
  document.getElementById("sidebar-status")!.textContent =
    `hover-intent: on (${hoverDelayMs}ms)`;
}

function unwireHoverIntent(): void {
  if (hoverWiring?.enter) {
    document.removeEventListener("pointermove", hoverWiring.enter);
  }
  if (hoverWiring?.timer) clearTimeout(hoverWiring.timer);
  hoverWiring = null;
  document.getElementById("sidebar-status")!.textContent = "hover-intent: off";
}

/* Fake artifact pipeline so prompt-retry detection has something to observe. */
document.getElementById("prompt-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("prompt-input") as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const promptId = crypto.randomUUID();
  loop.tracker.trackPrompt(promptId, text);
  window.setTimeout(() => {
    addLayer(text);
    loop.tracker.trackArtifact("artifact-created", crypto.randomUUID(), "section", promptId, 600);
    loop.tracker.trackArtifact("artifact-accepted", crypto.randomUUID(), "section", promptId, 650);
    log("artifact", `created for “${text.slice(0, 28)}…”`, true);
  }, 600);
});

function addLayer(label: string): void {
  const li = document.createElement("li");
  li.textContent = label.slice(0, 40);
  document.getElementById("layer-list")!.prepend(li);
}
for (const seed of ["Hero", "Pricing", "Footer"]) addLayer(seed);

/* ------------------------------------------------------------------ */
/* Signal log                                                          */
/* ------------------------------------------------------------------ */

function log(kind: string, message: string, isFix: boolean): void {
  const entry = document.createElement("div");
  entry.className = `signal-entry${isFix ? " fix" : ""}`;
  entry.innerHTML = `<strong>${kind}</strong> — ${message}`;
  const logEl = document.getElementById("signal-log")!;
  logEl.prepend(entry);
  while (logEl.children.length > 8) logEl.lastChild?.remove();
}

function onSignals(signals: readonly FrustrationSignal[]): void {
  for (const signal of signals) {
    log(signal.kind, `${signal.feature} · confidence ${(signal.confidence * 100).toFixed(0)}%`, false);
  }
}

/* ------------------------------------------------------------------ */
/* Boot the whole loop                                                 */
/* ------------------------------------------------------------------ */

const ghostTargets = [
  {
    id: "left-sidebar-edge",
    feature: SIDEBAR_FEATURE,
    region: { x: 0, y: 0, width: 1, height: 1 }, // replaced below with viewport-aware zone
    tolerancePx: 90,
    minApproachSpeedPxMs: 0.6,
    expectedProperty: "open",
    expectedValue: "true",
    repeatWindowMs: 8000,
    attemptsThreshold: 2,
  },
];

// The right-edge strip is computed at install time and kept fresh on resize.
function rightEdgeRegion() {
  return {
    x: Math.max(0, window.innerWidth - 40),
    y: 0,
    width: 40,
    height: window.innerHeight,
  };
}
ghostTargets[0]!.region = rightEdgeRegion();
window.addEventListener("resize", () => {
  ghostTargets[0]!.region = rightEdgeRegion();
});

const detectorConfig = { ghostGesture: { targets: ghostTargets, speedLookbackMs: 150 } };

const loop = await startSelfImprovement({
  apply: applyAdaptationInApp,
  revert: revertAdaptationInApp,
  detectorConfig,
  onSignals,
  appVersion: "improved-source-demo",
  policy: { autoApplyConfidence: 0.55 },
});
log("ready", "observing interactions locally — nothing leaves this machine", true);
