export const DESIGN_ROUTE_PREFIX = "/design";

export function getProjectIdFromPath(pathname: string): string | null {
  if (!pathname || pathname === "/" || pathname === "/index.html") return null;
  // Normalize: remove trailing slash
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === DESIGN_ROUTE_PREFIX) return null;
  if (clean.startsWith(`${DESIGN_ROUTE_PREFIX}/`)) {
    const id = clean.slice(DESIGN_ROUTE_PREFIX.length + 1);
    if (!id) return null;
    try {
      const decoded = decodeURIComponent(id);
      // Basic validation: project ids are like "project-..."
      if (decoded.length === 0 || decoded.length > 256) return null;
      if (decoded.includes("/") || decoded.includes("?") || decoded.includes("#")) return null;
      return decoded;
    } catch {
      return null;
    }
  }
  // Also support legacy /project/:id and /p/:id for robustness
  if (clean.startsWith("/project/")) {
    const id = clean.slice("/project/".length);
    return id ? decodeURIComponent(id) : null;
  }
  if (clean.startsWith("/p/")) {
    const id = clean.slice("/p/".length);
    return id ? decodeURIComponent(id) : null;
  }
  return null;
}

export function getProjectIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return getProjectIdFromPath(window.location.pathname);
}

export function buildProjectUrl(id: string): string {
  return `${DESIGN_ROUTE_PREFIX}/${encodeURIComponent(id)}`;
}

export function isHomePath(pathname: string): boolean {
  return getProjectIdFromPath(pathname) === null;
}

export function navigateToProject(id: string, options: { replace?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const url = buildProjectUrl(id);
  if (window.location.pathname === url) return;
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function navigateToHome(options: { replace?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/") return;
  if (options.replace) window.history.replaceState(null, "", "/");
  else window.history.pushState(null, "", "/");
}

export function isDesignRoute(pathname: string): boolean {
  return getProjectIdFromPath(pathname) !== null;
}
