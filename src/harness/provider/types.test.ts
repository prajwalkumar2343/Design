import { describe, expect, it } from "vitest";

import { mapProviderStatus, ProviderError } from "./types";

describe("mapProviderStatus", () => {
  it("maps auth, rate-limit, client, and server statuses to stable codes", () => {
    expect(mapProviderStatus(401, "no key")).toBe("auth");
    expect(mapProviderStatus(403, "forbidden")).toBe("auth");
    expect(mapProviderStatus(429, "slow down")).toBe("rate-limit");
    expect(mapProviderStatus(400, "bad")).toBe("bad-request");
    expect(mapProviderStatus(422, "bad")).toBe("bad-request");
    expect(mapProviderStatus(500, "boom")).toBe("model-error");
    expect(mapProviderStatus(503, "down")).toBe("model-error");
    expect(mapProviderStatus(0, "?")).toBe("unknown");
    expect(mapProviderStatus(302, "redirect")).toBe("unknown");
  });
});

describe("ProviderError", () => {
  it("carries the code, status, and cause", () => {
    const cause = new Error("socket closed");
    const error = new ProviderError("network", "fetch failed", { status: 0, cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProviderError");
    expect(error.code).toBe("network");
    expect(error.status).toBe(0);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("fetch failed");
  });

  it("leaves status undefined when not supplied", () => {
    expect(new ProviderError("cancelled", "aborted").status).toBeUndefined();
  });
});
