# Canvas Capture — browser extension

A self-contained Manifest V3 extension that captures any section of a web page
as **HTML + CSS** and copies it to the clipboard. Paste it onto the Canvas app
(`Cmd/Ctrl+V`) and the section appears as an editable frame on the canvas.

This folder is deliberately separate from the Canvas web app (`src/`) — no
build step, no shared code, no dependencies. The two sides only agree on the
clipboard contract documented below.

## Install (load unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`browser-extension-source`).

## Usage

1. Visit any web page and click the toolbar icon.
2. Hover a section to highlight it. The label shows the element and its size.
3. **Click** the section to copy its HTML + CSS to the clipboard.
   - `↑` expands the selection to the parent element.
   - `Enter` captures the hovered section.
   - `Esc` (or a second toolbar click) cancels.
4. Open the Canvas app and press `Cmd/Ctrl+V`. The section is pasted as a new,
   selectable, fully styled frame.

## How capture works

- The selected element is deep-cloned; `script`, `iframe`, `object`, `embed`,
  `base`, `link`, `meta`, `noscript`, `template`, media stubs and similar
  non-visual tags are removed.
- Every remaining element gets its **computed styles inlined** — but only the
  properties whose computed value differs from its parent, so the output stays
  compact while rendering pixel-faithfully in isolation.
- The result is wrapped in a complete `<!doctype html>` document (so Canvas
  can store and re-import it) with the section's background color on `<body>`.

## Clipboard contract with Canvas

The extension writes both `text/html` and `text/plain` to the clipboard
(both carry the same full HTML document). The `<html>` element carries
metadata attributes that Canvas reads and then strips:

| Attribute | Meaning |
| --- | --- |
| `data-canvas-paste-source` | URL of the captured page |
| `data-canvas-paste-title` | Title of the captured page |
| `data-canvas-paste-width` / `-height` | Rendered size of the section (px) |
| `data-canvas-paste-background` | Nearest opaque background color |

Canvas uses the metadata to name and size the new frame, stores the HTML
verbatim as a `design`-mode document, and renders it inside its sandboxed
iframe. The contract is implemented in `src/clipboard/paste-html.ts` and
covered by tests there.

## Files

```
manifest.json          MV3 manifest (permissions: activeTab, scripting, clipboardWrite)
background.js          Service worker; injects the picker on toolbar click
content/capture.js     HTML + CSS serializer (clipboard write)
content/picker.js      Hover/click selection UI
content/picker.css     Picker styles (injected via insertCSS, CSP-proof)
icons/                 Toolbar icons (+ regenerate with node icons/generate-icons.mjs)
```

## Known limitations

- Captures light-DOM elements; content inside cross-origin iframes is not
  reachable (the iframe element itself is intentionally not capturable), and
  shadow-DOM content is not serialized.
- Pseudo-element styles (`::before`/`::after`) and web-font files are not
  captured; text falls back to locally available fonts.
- Fixed-position elements become absolute relative to the pasted frame, which
  keeps the section visually intact.
