import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserPersistenceAdapter } from "./adapter";

describe("BrowserPersistenceAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a browser-like file through the replaceable file boundary", async () => {
    const adapter = new BrowserPersistenceAdapter();
    const file = { name: "project.wirecanvas.json", text: vi.fn(async () => "{\"kind\":\"wirecanvas-project\"}") };

    await expect(adapter.readProjectFile(file)).resolves.toBe("{\"kind\":\"wirecanvas-project\"}");
    expect(file.text).toHaveBeenCalledTimes(1);
  });

  it("downloads a Blob with the requested filename and MIME type", () => {
    const adapter = new BrowserPersistenceAdapter();
    const createObjectURL = vi.fn((_: Blob) => "blob:wirecanvas");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    let clickedDownload: string | undefined;
    let clickedHref: string | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
      clickedHref = this.href;
    });

    adapter.downloadProjectFile({
      text: "{\"kind\":\"wirecanvas-project\"}",
      filename: "project.wirecanvas.json",
      mimeType: "application/json",
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(click).toHaveBeenCalledTimes(1);
    expect(clickedDownload).toBe("project.wirecanvas.json");
    expect(clickedHref).toBe("blob:wirecanvas");
  });
});
