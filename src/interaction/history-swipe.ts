const HORIZONTAL_SCROLLABLE_SELECTOR = ".sidebar-panel-content, .properties-scroll, .figma-lake-body, .figma-lake, .project-lake";

const canScrollHorizontally = (element: Element | null): boolean => {
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      const overflowX = getComputedStyle(current).overflowX;
      const scrollable = overflowX === "auto" || overflowX === "scroll";
      if (scrollable && current.scrollWidth > current.clientWidth + 1) return true;
    }
    current = current.parentElement;
  }
  return false;
};

export const installHistorySwipeGuard = (target: Window = window): (() => void) => {
  const handleWheel = (event: WheelEvent) => {
    if (!event.cancelable) return;
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (canScrollHorizontally(event.target as Element | null)) return;
    event.preventDefault();
  };
  target.addEventListener("wheel", handleWheel, { passive: false });
  return () => target.removeEventListener("wheel", handleWheel);
};
