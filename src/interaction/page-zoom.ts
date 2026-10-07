const PAGE_ZOOM_KEYS = new Set(["=", "+", "-", "_", "0"]);

const isZoomKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && PAGE_ZOOM_KEYS.has(event.key);

export const installPageZoomGuard = (target: Window = window): (() => void) => {
  const handleWheel = (event: WheelEvent) => {
    if (!event.cancelable) return;
    // Trackpad pinch arrives as ctrl+wheel; the canvas surface turns it into
    // camera zoom. Anywhere else the default is a whole-site zoom — block it.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
  };

  // Safari fires proprietary gesture events for trackpad pinch instead of
  // ctrl+wheel. Preventing them is the only way to stop the page zoom.
  const handleGesture = (event: Event) => {
    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isZoomKey(event)) event.preventDefault();
  };

  target.addEventListener("wheel", handleWheel, { passive: false });
  target.document.addEventListener("gesturestart", handleGesture);
  target.document.addEventListener("gesturechange", handleGesture);
  target.document.addEventListener("gestureend", handleGesture);
  target.addEventListener("keydown", handleKeyDown);
  return () => {
    target.removeEventListener("wheel", handleWheel);
    target.document.removeEventListener("gesturestart", handleGesture);
    target.document.removeEventListener("gesturechange", handleGesture);
    target.document.removeEventListener("gestureend", handleGesture);
    target.removeEventListener("keydown", handleKeyDown);
  };
};
