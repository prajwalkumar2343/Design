// Canvas Capture — element picker.
//
// Injected on toolbar click. Hover to highlight, click to copy the section's
// HTML + CSS to the clipboard (ready to paste onto Canvas with Cmd/Ctrl+V).
// ArrowUp expands to the parent element, Enter captures the hovered section,
// Esc (or a second toolbar click) cancels.

(function () {
  "use strict";

  if (window.__canvasCapture?.active) {
    window.__canvasCapture.deactivate();
    return;
  }

  const instance = startPicker();
  window.__canvasCapture = instance;

  function startPicker() {
    const state = {
      active: true,
      hovered: null,
      highlight: null,
      label: null,
      hint: null,
      overlay: null,
      listeners: [],
    };

    state.overlay = document.createElement("div");
    state.overlay.id = "canvas-capture-overlay";

    state.highlight = document.createElement("div");
    state.highlight.className = "cc-highlight";

    state.label = document.createElement("div");
    state.label.className = "cc-label";

    state.hint = document.createElement("div");
    state.hint.className = "cc-hint";
    state.hint.innerHTML =
      "<span class=\"cc-hint-title\">Canvas Capture</span>" +
      "<span class=\"cc-hint-key\">Click</span><span>copy section</span>" +
      "<span class=\"cc-hint-key\">↑</span><span>parent</span>" +
      "<span class=\"cc-hint-key\">Esc</span><span>cancel</span>";

    state.overlay.append(state.highlight, state.label, state.hint);
    document.documentElement.appendChild(state.overlay);

    function listen(type, handler, options) {
      window.addEventListener(type, handler, options);
      state.listeners.push({ type, handler, options });
    }

    function removeListeners() {
      for (const { type, handler, options } of state.listeners) {
        window.removeEventListener(type, handler, options);
      }
      state.listeners = [];
    }

    function pick(x, y) {
      const candidates = document.elementsFromPoint(x, y);
      for (const candidate of candidates) {
        if (!candidate || candidate.id === "canvas-capture-overlay") {
          continue;
        }
        if (candidate.nodeType === Node.ELEMENT_NODE) {
          return candidate;
        }
      }
      return null;
    }

    function describe(element) {
      if (!element) {
        return "";
      }
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      const classes = typeof element.className === "string"
        ? Array.from(element.classList).slice(0, 3).map((name) => `.${name}`).join("")
        : "";
      return `${tag}${id}${classes}`;
    }

    function renderHighlight() {
      if (!state.hovered) {
        state.highlight.style.display = "none";
        state.label.style.display = "none";
        return;
      }
      const rect = state.hovered.getBoundingClientRect();
      state.highlight.style.display = "block";
      state.highlight.style.left = `${rect.left}px`;
      state.highlight.style.top = `${rect.top}px`;
      state.highlight.style.width = `${rect.width}px`;
      state.highlight.style.height = `${rect.height}px`;

      state.label.style.display = "block";
      state.label.textContent =
        `${describe(state.hovered)} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
      const labelRect = state.label.getBoundingClientRect();
      const labelTop = Math.max(6, rect.top - labelRect.height - 8);
      state.label.style.left = `${Math.min(
        Math.max(6, rect.left),
        window.innerWidth - labelRect.width - 6,
      )}px`;
      state.label.style.top = `${labelTop}px`;
    }

    function showToast(message, isError) {
      const existing = document.getElementById("canvas-capture-toast");
      if (existing) {
        existing.remove();
      }
      const toast = document.createElement("div");
      toast.id = "canvas-capture-toast";
      toast.className = `cc-toast${isError ? " is-error" : ""}`;
      toast.textContent = message;
      document.documentElement.appendChild(toast);
      setTimeout(() => toast.remove(), isError ? 4000 : 2600);
    }

    async function capture(element) {
      const section = window.CanvasCapture.captureSection(element);
      if (!section) {
        showToast("That element can't be captured — pick a visible section instead.", true);
        return;
      }
      try {
        await window.CanvasCapture.copyHtmlToClipboard(section.html);
        showToast("Section copied — paste it onto Canvas with Cmd/Ctrl+V.");
        cleanup();
      } catch {
        showToast("Clipboard write failed — try clicking the section again.", true);
      }
    }

    function cleanup() {
      if (!state.active) {
        return;
      }
      state.active = false;
      removeListeners();
      state.overlay.remove();
      document.documentElement.classList.remove("cc-picking");
      if (window.__canvasCapture === instance) {
        window.__canvasCapture = { active: false, deactivate() {} };
      }
    }

    const onMouseMove = (event) => {
      state.hovered = pick(event.clientX, event.clientY);
      renderHighlight();
    };
    const onClick = (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = pick(event.clientX, event.clientY);
      if (target) {
        void capture(target);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup();
        return;
      }
      if (event.key === "ArrowUp" && state.hovered) {
        event.preventDefault();
        const parent = state.hovered.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          state.hovered = parent;
          renderHighlight();
        }
        return;
      }
      if (event.key === "Enter" && state.hovered) {
        event.preventDefault();
        void capture(state.hovered);
      }
    };
    const onScroll = () => renderHighlight();
    const onResize = () => renderHighlight();

    listen("mousemove", onMouseMove, true);
    listen("click", onClick, true);
    listen("keydown", onKeyDown, true);
    listen("scroll", onScroll, true);
    listen("resize", onResize, true);

    document.documentElement.classList.add("cc-picking");

    return {
      active: state.active,
      deactivate: cleanup,
    };
  }
})();
