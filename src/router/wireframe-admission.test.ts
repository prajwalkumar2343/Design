import { describe, expect, it } from "vitest";

import { validateWireframeHtml } from "./wireframe-admission";
import { WIREFRAME_THEME_MARKER } from "../frame/wireframe-theme";

const validWireframe = `<!doctype html>
<html lang="en">
  <head>
    <style>
      :root { box-sizing: border-box; }
      .page {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: clamp(12px, 2vw, 24px);
        padding: clamp(16px, 4vw, 48px);
      }
      .row { display: flex; align-items: center; justify-content: space-between; }
      @media (max-width: 720px) {
        .page { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="row"><h1>Project</h1><p>Wireframe copy</p></section>
      <form action="#"><label for="email">Email</label><input id="email" /></form>
      <a href="#details">Details</a>
    </main>
  </body>
</html>`;

function expectViolation(html: string, code: string): void {
  expect(() => validateWireframeHtml(html)).toThrowError(
    expect.objectContaining({
      violations: expect.arrayContaining([expect.objectContaining({ code })]),
    }),
  );
}

describe("structured wireframe HTML admission", () => {
  it("accepts semantic HTML with neutral layout and responsive typography CSS", () => {
    expect(validateWireframeHtml(validWireframe)).toMatchObject({ mode: "wireframe" });
  });

  it.each([
    ["script", "<!doctype html><html><body><script>console.log(1)</script></body></html>", "script"],
    ["event handler", "<!doctype html><html><body><button onclick=\"go()\">Go</button></body></html>", "event-handler"],
    ["embedded content", "<!doctype html><html><body><iframe src=\"#frame\"></iframe></body></html>", "embedded-content"],
    ["media", "<!doctype html><html><body><img src=\"#image\"></body></html>", "media"],
    ["external resource", "<!doctype html><html><head><link rel=\"stylesheet\" href=\"/app.css\"></head><body></body></html>", "external-resource"],
    ["navigation", "<!doctype html><html><body><a href=\"https://example.com\">Go</a></body></html>", "navigation"],
    ["form action", "<!doctype html><html><body><form action=\"/submit\"></form></body></html>", "form-action"],
    ["CSS URL", "<!doctype html><html><head><style>.x { background-image: url(https://example.com/x) }</style></head><body></body></html>", "css-function"],
    ["CSS import", "<!doctype html><html><head><style>@import url(https://example.com/x);</style></head><body></body></html>", "css-at-rule"],
    ["CSS font face", "<!doctype html><html><head><style>@font-face { font-family: x; src: url(x) }</style></head><body></body></html>", "css-at-rule"],
    ["animation", "<!doctype html><html><head><style>.x { animation: pulse 1s; }</style></head><body></body></html>", "css-property"],
    ["transition", "<!doctype html><html><head><style>.x { transition: opacity 1s; }</style></head><body></body></html>", "css-property"],
    ["arbitrary color", "<!doctype html><html><head><style>.x { color: red; }</style></head><body></body></html>", "css-property"],
    ["background", "<!doctype html><html><head><style>.x { background: white; }</style></head><body></body></html>", "css-property"],
    ["border", "<!doctype html><html><head><style>.x { border: 1px solid; }</style></head><body></body></html>", "css-property"],
    ["shadow", "<!doctype html><html><head><style>.x { box-shadow: 0 0 2px; }</style></head><body></body></html>", "css-property"],
    ["filter", "<!doctype html><html><head><style>.x { filter: blur(2px); }</style></head><body></body></html>", "css-property"],
    ["opacity", "<!doctype html><html><head><style>.x { opacity: .5; }</style></head><body></body></html>", "css-property"],
    ["transform", "<!doctype html><html><head><style>.x { transform: translateX(1px); }</style></head><body></body></html>", "css-property"],
    ["pseudo content", "<!doctype html><html><head><style>.x::before { content: \"x\"; }</style></head><body></body></html>", "css-pseudo-content"],
  ])("rejects %s", (_name, html, code) => {
    expectViolation(html, code);
  });

  it.each(["font", "marquee", "blink"])("rejects legacy <%s> elements", (tagName) => {
    expectViolation(
      `<!doctype html><html><body><${tagName}>Legacy content</${tagName}></body></html>`,
      "legacy-element",
    );
  });

  it.each([
    "bgcolor",
    "color",
    "background",
    "border",
    "cellpadding",
    "cellspacing",
    "face",
    "size",
    "align",
    "valign",
    "width",
    "height",
  ])("rejects presentational %s attributes", (attribute) => {
    expectViolation(
      `<!doctype html><html><body><div ${attribute}=\"1\">Content</div></body></html>`,
      "presentation-attribute",
    );
  });

  it("rejects MathML and namespaced attributes", () => {
    expectViolation(
      "<!doctype html><html><body><math xmlns=\"http://www.w3.org/1998/Math/MathML\"><mi>x</mi></math></body></html>",
      "namespace",
    );
    expectViolation(
      "<!doctype html><html><body><div xlink:href=\"#icon\">Content</div></body></html>",
      "namespace",
    );
  });

  it("rejects base and every meta http-equiv directive while allowing safe metadata", () => {
    expectViolation(
      "<!doctype html><html><head><base href=\"https://example.com/\"></head><body></body></html>",
      "metadata",
    );
    expectViolation(
      "<!doctype html><html><head><meta http-equiv=\"refresh\" content=\"0;url=https://example.com\"></head><body></body></html>",
      "metadata",
    );
    expectViolation(
      "<!doctype html><html><head><meta http-equiv=\"content-security-policy\" content=\"script-src *\"></head><body></body></html>",
      "metadata",
    );
    expect(validateWireframeHtml(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body><main>Safe metadata</main></body></html>",
    )).toMatchObject({ mode: "wireframe" });
  });

  it("rejects unsafe CSS functions and permits only safe nested at-rules", () => {
    expectViolation(
      "<!doctype html><html><head><style>.x { width: var(--unsafe); }</style></head><body></body></html>",
      "css-function",
    );
    expectViolation(
      "<!doctype html><html><head><style>@keyframes pulse { from { display: block; } }</style></head><body></body></html>",
      "css-at-rule",
    );
    expect(validateWireframeHtml(
      "<!doctype html><html><head><style>@supports (display: grid) { @media (min-width: 1px) { .x { display: grid; } } }</style></head><body><div class=x></div></body></html>",
    )).toMatchObject({ mode: "wireframe" });
  });

  it("rejects incomplete documents and preserves the base admission error family", () => {
    expectViolation("<main>fragment</main>", "invalid-html");
    expectViolation(
      "<!doctype html><html><body><div data-design-tool-iframe-bridge=\"1\"></div></body></html>",
      "reserved-runtime-marker",
    );
    expectViolation(
      `<!doctype html><html><head><style ${WIREFRAME_THEME_MARKER}=\"1\"></style></head><body></body></html>`,
      "reserved-wireframe-theme-marker",
    );
  });
});
