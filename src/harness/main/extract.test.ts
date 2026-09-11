import { describe, expect, it } from "vitest";

import { extractHtmlFromOutput } from "./extract";

describe("extractHtmlFromOutput", () => {
  it("extracts a fenced html block", () => {
    const result = extractHtmlFromOutput("Here you go:\n```html\n<!DOCTYPE html>\n<html></html>\n```\nEnjoy!");
    expect(result.fenced).toBe(true);
    expect(result.html).toBe("<!DOCTYPE html>\n<html></html>");
  });

  it("extracts a bare code fence without a language", () => {
    const result = extractHtmlFromOutput("```\n<p>hi</p>\n```");
    expect(result.fenced).toBe(true);
    expect(result.html).toBe("<p>hi</p>");
  });

  it("extracts a block whose closing fence is not on its own line", () => {
    const result = extractHtmlFromOutput("```html\n<!DOCTYPE html>\n<html></html>```");
    expect(result.fenced).toBe(true);
    expect(result.html).toBe("<!DOCTYPE html>\n<html></html>");
  });

  it("does not treat other language fences as html", () => {
    const result = extractHtmlFromOutput("```js\nconsole.log(1)\n```");
    expect(result.fenced).toBe(false);
    expect(result.html).toBe("```js\nconsole.log(1)\n```");
  });

  it("falls back to the raw output", () => {
    const result = extractHtmlFromOutput("<!DOCTYPE html><html></html>");
    expect(result.fenced).toBe(false);
    expect(result.html).toBe("<!DOCTYPE html><html></html>");
  });
});
