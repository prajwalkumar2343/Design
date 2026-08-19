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

  it("downloads binary payloads such as .fig archives", () => {
    const adapter = new BrowserPersistenceAdapter();
    const createObjectURL = vi.fn((_: Blob) => "blob:figma");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      void this.download;
    });

    adapter.downloadProjectFile({
      text: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      filename: "project.fig",
      mimeType: "application/octet-stream",
    });

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/octet-stream");
    expect(blob.size).toBe(4);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
