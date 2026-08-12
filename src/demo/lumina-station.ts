import luminaHeroDataUri from "../assets/lumina-station-hero.png?inline";

/**
 * A self-contained product-stage document. The image is inlined at build time
 * so sandboxed previews never depend on a relative or remote URL.
 */
export const luminaStationDocument = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f3f1ed" />
    <title>Lumina Station — Quiet power, clearly arranged.</title>
    <style>
      :root {
        --ink: #171819;
        --ink-soft: #5f6263;
        --ink-faint: #898c8c;
        --paper: #f3f1ed;
        --surface: #fbfaf8;
        --surface-warm: #ebe8e1;
        --line: rgba(23, 24, 25, .15);
        --line-soft: rgba(23, 24, 25, .09);
        --accent: #9b4e2d;
        --accent-dark: #763a25;
        --serif: Georgia, "Times New Roman", serif;
        --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --ease-out: cubic-bezier(.16, 1, .3, 1);
        --duration: 520ms;
      }

      *, *::before, *::after { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        min-width: 320px;
        color: var(--ink);
        background: var(--paper);
        font-family: var(--sans);
        font-size: 16px;
        line-height: 1.5;
        text-rendering: optimizeLegibility;
      }
      a { color: inherit; }
      a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
      .skip-link {
        position: fixed;
        top: 12px;
        left: 16px;
        z-index: 4;
        padding: 10px 14px;
        color: var(--surface);
        background: var(--ink);
        border-radius: 8px;
        transform: translateY(-160%);
        transition: transform 180ms var(--ease-out);
      }
      .skip-link:focus { transform: translateY(0); }
      .shell { width: min(100% - 48px, 1280px); margin: 0 auto; }
      .station-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 76px;
        border-bottom: 1px solid var(--line-soft);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 11px;
        color: var(--ink);
        font-size: 14px;
        font-weight: 680;
        letter-spacing: -.02em;
        text-decoration: none;
      }
      .brand-mark {
        display: grid;
        width: 24px;
        height: 24px;
        place-items: center;
        color: var(--surface);
        background: var(--ink);
        border-radius: 50%;
        font-family: var(--serif);
        font-size: 15px;
        font-style: italic;
      }
      .station-nav { display: flex; align-items: center; gap: 26px; }
      .station-nav a {
        color: var(--ink-soft);
        font-size: 13px;
        font-weight: 530;
        text-decoration: none;
        transition: color 180ms ease;
      }
      .station-nav a:hover { color: var(--ink); }
      .nav-action {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        padding: 0 16px;
        color: var(--surface);
        background: var(--ink);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 650;
        text-decoration: none;
        transition: background 180ms ease, transform 180ms ease;
      }
      .nav-action:hover { background: var(--accent-dark); transform: translateY(-1px); }

      .hero {
        display: grid;
        min-height: 740px;
        grid-template-columns: minmax(0, .84fr) minmax(420px, 1.16fr);
        align-items: center;
        gap: clamp(44px, 7vw, 116px);
        padding: 58px 0 80px;
      }
      .hero-copy { max-width: 480px; }
      .eyebrow, .section-kicker {
        margin: 0 0 20px;
        color: var(--accent);
        font-size: 11px;
        font-weight: 750;
        letter-spacing: .16em;
        line-height: 1.2;
        text-transform: uppercase;
      }
      h1, h2, p { margin-top: 0; }
      h1 {
        max-width: 8.5ch;
        margin-bottom: 28px;
        font-size: clamp(58px, 6.2vw, 96px);
        font-weight: 560;
        letter-spacing: -.075em;
        line-height: .92;
        text-wrap: balance;
      }
      .hero-lede {
        max-width: 34ch;
        margin-bottom: 32px;
        color: var(--ink-soft);
        font-size: clamp(17px, 1.35vw, 21px);
        letter-spacing: -.025em;
        line-height: 1.45;
        text-wrap: pretty;
      }
      .hero-links { display: flex; align-items: center; gap: 22px; }
      .primary-action {
        display: inline-flex;
        min-height: 48px;
        align-items: center;
        padding: 0 20px;
        color: var(--surface);
        background: var(--accent);
        border-radius: 999px;
        font-size: 13px;
        font-weight: 680;
        text-decoration: none;
        transition: background 180ms ease, transform 180ms ease;
      }
      .primary-action:hover { background: var(--accent-dark); transform: translateY(-1px); }
      .text-link {
        color: var(--ink);
        font-size: 13px;
        font-weight: 620;
        text-underline-offset: 4px;
        text-decoration-thickness: 1px;
      }
      .product-stage {
        position: relative;
        min-width: 0;
        overflow: hidden;
        aspect-ratio: 1.15 / 1;
        background: var(--surface);
        border: 1px solid var(--line-soft);
        border-radius: 24px;
        box-shadow: 0 24px 70px rgba(30, 28, 24, .1);
      }
      .product-stage::before {
        position: absolute;
        inset: 16px;
        z-index: 1;
        border: 1px solid rgba(255, 255, 255, .72);
        border-radius: 16px;
        content: "";
        pointer-events: none;
      }
      .product-stage img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: 58% center;
      }
      .stage-caption {
        position: absolute;
        right: 30px;
        bottom: 28px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        color: rgba(23, 24, 25, .72);
        background: rgba(251, 250, 248, .76);
        border: 1px solid rgba(255, 255, 255, .88);
        border-radius: 999px;
        backdrop-filter: blur(12px) saturate(120%);
        font-size: 11px;
        letter-spacing: .02em;
      }
      .stage-caption::before { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; content: ""; }
      .hero-note {
        position: absolute;
        right: max(24px, 4vw);
        bottom: 30px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--ink-faint);
        font-size: 11px;
        letter-spacing: .09em;
        text-transform: uppercase;
        writing-mode: vertical-rl;
      }
      .hero-note::before { width: 1px; height: 34px; background: var(--line); content: ""; }

      .feature-section {
        padding: 118px 0 132px;
        border-top: 1px solid var(--line);
        background: var(--surface-warm);
        scroll-margin-top: 24px;
      }
      .feature-heading {
        display: grid;
        grid-template-columns: minmax(220px, .62fr) minmax(0, 1fr);
        gap: 56px;
        margin-bottom: 72px;
      }
      .feature-heading h2 {
        max-width: 15ch;
        margin-bottom: 0;
        font-size: clamp(34px, 4vw, 60px);
        font-weight: 550;
        letter-spacing: -.06em;
        line-height: .98;
        text-wrap: balance;
      }
      .feature-intro {
        max-width: 42ch;
        align-self: end;
        margin-bottom: 4px;
        color: var(--ink-soft);
        font-size: 17px;
        line-height: 1.55;
      }
      .feature-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0;
        border-top: 1px solid var(--line);
      }
      .feature {
        min-height: 224px;
        padding: 26px 28px 20px 0;
        border-right: 1px solid var(--line);
      }
      .feature + .feature { padding-left: 28px; }
      .feature:last-child { border-right: 0; }
      .feature-number { color: var(--accent); font-size: 12px; font-variant-numeric: tabular-nums; }
      .feature h3 { margin: 42px 0 12px; font-size: 19px; font-weight: 630; letter-spacing: -.025em; }
      .feature p { max-width: 26ch; margin-bottom: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
      .feature-foot {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        margin-top: 72px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        color: var(--ink-faint);
        font-size: 11px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      @media (max-width: 1000px) {
        .shell { width: min(100% - 40px, 760px); }
        .hero { grid-template-columns: 1fr; gap: 52px; padding-top: 72px; }
        .hero-copy { max-width: 620px; }
        h1 { max-width: 10ch; }
        .product-stage { width: min(100%, 680px); justify-self: end; }
        .hero-note { display: none; }
      }
      @media (max-width: 640px) {
        .shell { width: min(100% - 32px, 520px); }
        .station-header { min-height: 64px; }
        .station-nav { gap: 14px; }
        .station-nav a:not(.nav-action) { display: none; }
        .nav-action { min-height: 36px; padding: 0 13px; }
        .hero { min-height: auto; gap: 42px; padding: 58px 0 76px; }
        h1 { margin-bottom: 22px; font-size: clamp(54px, 16vw, 76px); }
        .hero-lede { margin-bottom: 26px; font-size: 17px; }
        .hero-links { align-items: flex-start; flex-direction: column; gap: 18px; }
        .product-stage { aspect-ratio: .92 / 1; border-radius: 18px; }
        .product-stage::before { inset: 10px; border-radius: 12px; }
        .product-stage img { object-position: 58% center; }
        .stage-caption { right: 18px; bottom: 18px; }
        .feature-section { padding: 78px 0 86px; }
        .feature-heading { display: block; margin-bottom: 52px; }
        .feature-heading h2 { margin-bottom: 24px; font-size: 40px; }
        .feature-intro { font-size: 16px; }
        .feature-grid { display: block; }
        .feature, .feature + .feature { min-height: 0; padding: 24px 0 28px; border-right: 0; border-bottom: 1px solid var(--line); }
        .feature:last-child { border-bottom: 0; }
        .feature h3 { margin-top: 30px; }
        .feature-foot { align-items: flex-start; flex-direction: column; gap: 7px; margin-top: 44px; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="station-header shell">
      <a class="brand" href="#top" aria-label="Lumina Station home"><span class="brand-mark" aria-hidden="true">L</span><span>Lumina Station</span></a>
      <nav class="station-nav" aria-label="Primary navigation">
        <a href="#features">Details</a>
        <a href="#design-notes">Design notes</a>
        <a class="nav-action" href="#features">See the system</a>
      </nav>
    </header>
    <main id="main-content">
      <section class="hero shell" id="top" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">Lumina / Station 01</p>
          <h1 id="hero-title">Quiet power, clearly arranged.</h1>
          <p class="hero-lede">A compact compute station designed to make complex work feel composed, from the first connection to the final render.</p>
          <div class="hero-links">
            <a class="primary-action" href="#features">Explore the system</a>
            <a class="text-link" href="#design-notes">Read the design notes <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <figure class="product-stage">
          <img src="${luminaHeroDataUri}" alt="Lumina Station modular compute hardware with a softly lit control panel" width="1536" height="1024" />
          <figcaption class="stage-caption">Modular compute / 2026</figcaption>
        </figure>
        <p class="hero-note" aria-hidden="true">Scroll to continue</p>
      </section>
      <section class="feature-section" id="features" aria-labelledby="feature-title">
        <div class="shell">
          <div class="feature-heading">
            <p class="section-kicker">The station, in three moves</p>
            <div>
              <h2 id="feature-title">Less ceremony between thought and output.</h2>
              <p class="feature-intro">Every detail has a job: keep the signal clear, make the scale legible, and let the work stay in focus.</p>
            </div>
          </div>
          <div class="feature-grid" id="design-notes">
            <article class="feature">
              <span class="feature-number">01</span>
              <h3>Modular by nature</h3>
              <p>Distinct thermal and compute zones make room for change without adding visual noise.</p>
            </article>
            <article class="feature">
              <span class="feature-number">02</span>
              <h3>Signal in the room</h3>
              <p>A quiet light language keeps status visible at the edge of your attention, never in its way.</p>
            </article>
            <article class="feature">
              <span class="feature-number">03</span>
              <h3>Built to recede</h3>
              <p>Soft edges, honest materials, and a small footprint leave the desk—and the idea—open.</p>
            </article>
          </div>
          <div class="feature-foot"><span>Product study / Lumina Station</span><span>HTML · CSS · local asset</span></div>
        </div>
      </section>
    </main>
  </body>
</html>`;
