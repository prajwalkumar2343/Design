import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectUrl,
  getProjectIdFromPath,
  getProjectIdFromUrl,
  isDesignRoute,
  isHomePath,
  navigateToHome,
  navigateToProject,
} from "./routing";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("getProjectIdFromPath", () => {
  it("treats the lake routes as home", () => {
    for (const path of ["", "/", "/index.html", "/design", "/design/", "//", "/design//"]) {
      expect(getProjectIdFromPath(path)).toBeNull();
    }
  });

  it("extracts ids from the design route and legacy aliases", () => {
    expect(getProjectIdFromPath("/design/project-1")).toBe("project-1");
    expect(getProjectIdFromPath("/project/project-2")).toBe("project-2");
    expect(getProjectIdFromPath("/p/project-3")).toBe("project-3");
  });

  it("decodes percent-encoded ids", () => {
    expect(getProjectIdFromPath("/design/a%20b")).toBe("a b");
    expect(getProjectIdFromPath("/design/%E2%9C%93")).toBe("✓");
  });

  it("never throws on malformed percent-encoding", () => {
    // A lone "%" or truncated escape wedges decodeURIComponent; routing must
    // fail closed to the lake instead of crashing hydration/popstate.
    for (const path of ["/design/%", "/design/%2", "/design/%zz", "/project/%", "/p/%41%"]) {
      expect(() => getProjectIdFromPath(path)).not.toThrow();
      expect(getProjectIdFromPath(path)).toBeNull();
    }
  });

  it("rejects ids that would escape the route segment", () => {
    expect(getProjectIdFromPath("/design/a%2Fb")).toBeNull();
    expect(getProjectIdFromPath("/design/a%3Fb")).toBeNull();
    expect(getProjectIdFromPath("/design/a%23b")).toBeNull();
    expect(getProjectIdFromPath("/design/a/b")).toBeNull();
    expect(getProjectIdFromPath("/design/%2e%2e%2fetc")).toBeNull();
  });

  it("rejects oversized ids at the 256-character cap", () => {
    expect(getProjectIdFromPath(`/design/${"x".repeat(256)}`)).toBe("x".repeat(256));
    expect(getProjectIdFromPath(`/design/${"x".repeat(257)}`)).toBeNull();
  });

  it("ignores unrelated routes", () => {
    expect(getProjectIdFromPath("/settings")).toBeNull();
    expect(getProjectIdFromPath("/designs/foo")).toBeNull();
    expect(getProjectIdFromPath("/pp/foo")).toBeNull();
  });

  it("round-trips ordinary ids through buildProjectUrl", () => {
    expect(getProjectIdFromPath(buildProjectUrl("project-123"))).toBe("project-123");
    expect(getProjectIdFromPath(buildProjectUrl("a b c"))).toBe("a b c");
  });

  it("fails closed on ids that can never satisfy the segment rules", () => {
    // Encoded slashes decode back into "/" and are rejected — buildProjectUrl
    // is only safe for ids that pass validation after decoding.
    const url = buildProjectUrl("a/b");
    expect(url).toBe("/design/a%2Fb");
    expect(getProjectIdFromPath(url)).toBeNull();
  });
});

describe("route helpers", () => {
  it("classifies home vs design routes consistently", () => {
    expect(isHomePath("/")).toBe(true);
    expect(isHomePath("/design/%")).toBe(true); // malformed → treated as home
    expect(isHomePath("/design/abc")).toBe(false);
    expect(isDesignRoute("/design/abc")).toBe(true);
    expect(isDesignRoute("/")).toBe(false);
  });

  it("reads the id from the live URL", () => {
    window.history.replaceState(null, "", "/design/live-1");
    expect(getProjectIdFromUrl()).toBe("live-1");
  });

  it("navigates to projects without redundant pushes", () => {
    navigateToProject("nav-1");
    expect(window.location.pathname).toBe("/design/nav-1");
    const callsBefore = window.history.length;
    navigateToProject("nav-1"); // same URL → no-op
    expect(window.location.pathname).toBe("/design/nav-1");
    expect(window.history.length).toBe(callsBefore);
    navigateToProject("nav-2", { replace: true });
    expect(window.location.pathname).toBe("/design/nav-2");
  });

  it("navigates home only when away", () => {
    window.history.replaceState(null, "", "/design/away");
    navigateToHome();
    expect(window.location.pathname).toBe("/");
    navigateToHome(); // no-op at home
    expect(window.location.pathname).toBe("/");
  });
});
