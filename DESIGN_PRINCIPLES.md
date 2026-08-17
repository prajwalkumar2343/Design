# Design Principles: The Best of the Best

A deep-research distillation of design principles, usability heuristics, cognitive laws, and component-level rules synthesized from the design systems and guidance of the world's leading technology companies and authorities:

- **Apple** (Human Interface Guidelines / iOS design principles)
- **Google** (Material Design, People + AI Research, "Ten things we know to be true")
- **Microsoft** (Fluent 2, product design principles)
- **IBM** (IBM Design Principles, Carbon)
- **Airbnb** (Design Language System)
- **GitHub** (Primer / "The Zen of GitHub")
- **Figma**, **Slack**, **Salesforce**, **Linear**, **Spotify**, **Stripe**
- **Nielsen Norman Group** (10 usability heuristics, homepage principles)
- **Jakob Nielsen / Ben Shneiderman / Don Norman** (classic interaction design)
- **Jon Yablonski — Laws of UX** (psychology and cognitive principles)
- **Adam Wathan & Steve Schoger — Refactoring UI** (practical UI tactics)
- **Dieter Rams** (industrial design principles)
- **US Web Design System**, **Government Digital Service** (government-grade usability)

The goal of this document is to be **actionable and specific** — not vague advice like "make it clean," but concrete rules you can apply to buttons, type, color, spacing, layout, motion, and whole pages.

---

## Table of Contents

1. [How to Use This Document](#1-how-to-use-this-document)
2. [Foundational Principles (The Unifying Truths)](#2-foundational-principles-the-unifying-truths)
3. [Company & System Design Principles](#3-company--system-design-principles)
4. [Human Factors, Psychology & Laws of UX](#4-human-factors-psychology--laws-of-ux)
5. [Information Architecture & Page Structure](#5-information-architecture--page-structure)
6. [Layout, Grid & Composition](#6-layout-grid--composition)
7. [Spacing & Density](#7-spacing--density)
8. [Typography](#8-typography)
9. [Color](#9-color)
10. [Depth, Shadows & Elevation](#10-depth-shadows--elevation)
11. [Imagery & Media](#11-imagery--media)
12. [Icons](#12-icons)
13. [Buttons & Action Triggers](#13-buttons--action-triggers)
14. [Links](#14-links)
15. [Forms & Inputs](#15-forms--inputs)
16. [Navigation, Headers & Menus](#16-navigation-headers--menus)
17. [Cards, Surfaces & Containers](#17-cards-surfaces--containers)
18. [Dialogs, Modals & Overlays](#18-dialogs-modals--overlays)
19. [Feedback: Toasts, Alerts, Errors & Empty States](#19-feedback-toasts-alerts-errors--empty-states)
20. [Motion & Microinteractions](#20-motion--microinteractions)
21. [Responsive Design & Breakpoints](#21-responsive-design--breakpoints)
22. [Accessibility](#22-accessibility)
23. [UX Writing & Content](#23-ux-writing--content)
24. [Design Tokens & Design Systems](#24-design-tokens--design-systems)
25. [Anti-Patterns (What Top Teams Avoid)](#25-anti-patterns-what-top-teams-avoid)
26. [Final QA Checklist](#26-final-qa-checklist)
27. [Sources](#27-sources)

---

## 1. How to Use This Document

- **Principles are decision tools, not decorations.** A principle is useful only if it helps you say "yes" or "no" to a specific design decision. If a principle never changes an outcome, remove it.
- **Rules have exceptions, and the exceptions need reasons.** When you break a rule, state the reason in one sentence.
- **Use the numbers as starting points.** Measurements are consensus starting points across Apple, Material, USWDS, and practical guides — tune them to your brand, but change deliberately, not randomly.
- **Consistency beats cleverness.** Users spend most of their time on *other* products (Jakob's Law). Familiar patterns reduce learning cost.

---

## 2. Foundational Principles (The Unifying Truths)

These are the truths nearly every major system independently converges on. If you only remember one section, remember this one.

### 2.1 Clarity and simplicity
- **Clarity is the first priority** (Apple). A design should be instantly understandable; anything that competes with clarity is decoration.
- **Subtractive design (IBM):** eliminate any visual element that doesn't contribute directly to communication.
- **Occam's razor (Laws of UX):** among designs that work equally well, choose the one with the fewest elements.
- **Tesler's Law:** every interface has irreducible complexity — the job is to decide *where* the complexity lives, not to pretend it doesn't exist.
- **"Keep the simple things simple, and make the complex things possible."** (Figma)

### 2.2 Hierarchy
- **Not all elements are equal (Refactoring UI).** Establish one dominant element per screen; everything else supports it.
- **Hierarchy is created by contrast in size, weight, color, position, and spacing** — not by adding more elements.
- **Three levels max at a glance:** eyebrow → headline → support/action. More layers flatten the message.
- **De-emphasize to emphasize:** the fastest way to make something important is to make other things quieter.

### 2.3 Consistency and standards
- **Consistency and Standards** (Nielsen heuristic #4, Shneiderman #1, Norman): users should never wonder whether different words, situations, or actions mean the same thing. Follow platform and industry conventions.
- **Two kinds of consistency:** internal (within your product/system) and external (with industry conventions).
- **"Things that look the same should behave the same, and an action should always produce the same result."** (IBM)
- Consistency is *not* conformity — adapt patterns to context, but keep the underlying grammar stable.

### 2.4 Feedback and system status
- **Visibility of system status** (Nielsen #1): always inform users about what is going on, within a reasonable time.
- **Every action deserves feedback** (Apple, Shneiderman #3): modest feedback for minor actions, substantial feedback for major ones.
- **Feedback should be immediate** — ideally within 0.1s; perceived response under 400ms keeps users in flow (Doherty Threshold).

### 2.5 User control and freedom
- **People — not apps — are in control (Apple).** An app may suggest or warn, but never take over decision-making.
- **Always provide an "emergency exit"** (Nielsen #3): undo, redo, cancel, escape.
- **Internal locus of control (Shneiderman #7):** make users the initiators, not the responders.
- **Confirm destructive actions; allow graceful cancellation of anything underway** (Apple, IBM).

### 2.6 Error prevention over error recovery
- **The best error message is the one that never happens** (Nielsen #5).
- **Prevent slips** (unconscious errors) with constraints, good defaults, and clear affordances.
- **Prevent mistakes** (conscious errors) by removing memory burdens, supporting undo, and warning before high-cost actions.
- **Design for failure (GitHub):** assume things will go wrong and degrade gracefully.

### 2.7 Recognition over recall
- **Minimize memory load (Nielsen #6):** make actions and options visible; don't make users remember information across parts of the interface.
- **Recognition beats recall (Miller's Law):** the average person holds ~7±2 items in working memory — keep displays simple and consolidate.

### 2.8 Aesthetic and minimalist design
- **Aesthetics = usability** (Aesthetic-Usability Effect, Nielsen #8): beautiful designs are perceived as more usable, and users are more forgiving of them.
- **Aesthetic integrity (Apple):** appearance must integrate with function; a serious tool should look serious.
- **Every extra unit of information competes with every other unit** — cut content and visual noise to what supports the primary goal.

### 2.9 Direct manipulation and natural mapping
- **Direct manipulation (Apple, Material):** let users touch, drag, pinch, and transform on-screen objects; show immediate, visible results.
- **Natural mapping (Norman):** controls should map to effects the way people expect (e.g., up arrow = up).
- **Mental models (Figma):** design around how humans think, not how the computer works.

### 2.10 Progress, performance and respect for time
- **"It's not fully shipped until it's fast" (GitHub).**
- **Responsive is better than fast (GitHub):** perceived responsiveness (feedback) matters more than raw speed.
- **Respect the user's attention (Figma):** guard users from unnecessary interruptions; don't assume — research.

---

## 3. Company & System Design Principles

### 3.1 Apple — iOS / HIG themes
1. **Aesthetic Integrity** — appearance and behavior must integrate with function to send a coherent message.
2. **Consistency** — use system-provided elements, standard icons, uniform terminology; be consistent internally, with the platform, and across versions.
3. **Direct Manipulation** — users see immediate, visible results of their gestures.
4. **Feedback** — perceptible feedback for every action; progress for long operations; animation and sound clarify results.
5. **Metaphors** — virtual objects map to familiar real/digital experiences, without being constrained by them.
6. **User Control** — people initiate and control actions; apps suggest and warn but don't decide.
7. *(Modern additions:)* **Deference, Clarity, Depth** — content is the hero, chrome recedes, and layered depth conveys hierarchy.

### 3.2 Google — Material Design
1. **Material is the metaphor** — surfaces, edges, and realistic lighting ground digital objects in tactile reality.
2. **Bold, graphic, intentional** — print-based fundamentals (type, grids, space, scale, color, imagery) create hierarchy, meaning, and focus; emphasize user actions.
3. **Motion provides meaning** — motion is meaningful and appropriate, focuses attention, maintains continuity; feedback is subtle yet clear; transitions efficient yet coherent.

### 3.3 Microsoft — Fluent 2 & product principles
1. **Natural on every platform** — adapt to the device, build on what's familiar; reuse native patterns ~80% of the time.
2. **Built for focus** — stay in the flow; less clutter and noise keeps people centered, calm, confident.
3. **One for all, all for one** — include a range of perspectives and abilities; design with diversity early.
4. **Unmistakably Microsoft** — signature experiences connect products; consistent color, sound, illustration, icons.

### 3.4 IBM — Design Principles (excerpts of 17)
1. Domain concepts should be central and apparent; use accurate relationships.
2. **Keep it simple** — easy access to features most users need most of the time.
3. **Optimize for the most frequent/important tasks.**
4. Make the interface accessible and choices visible (not hidden behind cryptic shortcuts).
5. Use proper default values for complex tasks.
6. Be flexible — let users customize and choose their own sequences.
7. Keep users informed and in control with timely, meaningful feedback.
8. Things that look the same should behave the same; avoid confusing modes.
9. **Provide undo and redo** — let users explore without fear of permanent damage.
10. Use industry-standard conventions (Ctrl+C, standard selection models).
11. Always keep target users in mind (personas, roles).
12. **Avoid features just to tick a list** — every feature adds choices.
13. Design for localization without redesign.
14. Consider people with disabilities.
15. Provide contextual help, not constant Help lookups.
16. Bring objects to life with good visual design (visual design is integral, not icing).
17. Promote **clarity and visual simplicity** — subtractive design, visual hierarchy, affordance, and white space as "breathing room."

### 3.5 Airbnb — Design Language System
1. **Unified** — each piece contributes to the whole at scale; no isolated features or outliers.
2. **Universal** — welcoming and accessible for a wide global community.
3. **Iconic** — focused design and functionality; work speaks boldly and clearly.
4. **Conversational** — motion breathes life into products and communicates clearly.

### 3.6 GitHub — The Zen of GitHub (Primer)
1. Responsive is better than fast.
2. It's not fully shipped until it's fast.
3. Anything added dilutes everything else.
4. Practicality beats purity.
5. Approachable is better than simple.
6. Mind your words, they are important.
7. Speak like a human.
8. Half measures are as bad as nothing at all.
9. Encourage flow.
10. Non-blocking is better than blocking.
11. Favor focus over features.
12. Avoid administrative distraction.
13. Design for failure.
14. Keep it logically awesome.

### 3.7 Figma — Design Principles
- **Professional:** Powerful, Precise, Systematic.
- **Approachable:** Predictable, Biased toward simplicity, Natural mental models.
- **Thoughtful:** Responsible, Detail-oriented, Respectful.

### 3.8 Google — "Ten Things We Know to Be True"
1. Focus on the user and all else will follow.
2. It's best to do one thing really, really well.
3. Fast is better than slow.
4. Democracy on the web works.
5. You don't need to be at your desk to need an answer.
6. You can make money without doing evil.
7. There's always more information out there.
8. The need for information crosses all borders.
9. You can be serious without a suit.
10. Great just isn't good enough.

### 3.9 Dieter Rams — Ten Principles of Good Design
1. Good design is innovative.
2. Good design makes a product useful.
3. Good design is aesthetic.
4. Good design makes a product understandable.
5. Good design is unobtrusive.
6. Good design is honest.
7. Good design is long-lasting.
8. Good design is thorough down to the last detail.
9. Good design is environmentally friendly.
10. Good design is as little design as possible.

### 3.10 Government / Public-service principles
**US Web Design System:** Start with real user needs; Earn trust; Embrace accessibility; Promote continuity; Listen.
**UK Government Digital Service:** Start with user needs; Do less; Design with data; Do the hard work to make it simple; Iterate; Build for inclusion; Understand context; Build digital services not websites; Be consistent; Make things open.

---

## 4. Human Factors, Psychology & Laws of UX

These are cognitive/perceptual laws that explain *why* design patterns work. Use them to diagnose and justify decisions.

### 4.1 Perception & grouping (Gestalt)
- **Law of Proximity** — elements near each other are perceived as related. Use spacing to group, not borders.
- **Law of Similarity** — elements that look alike are perceived as a group. Style implies relationship.
- **Law of Common Region** — elements sharing a bounded area (card, panel, border) are grouped.
- **Law of Uniform Connectedness** — visually connected elements are more related than unconnected ones.
- **Law of Prägnanz** — people perceive complex shapes as their simplest form; simplify visual noise.
- **Von Restorff Effect (Isolation Effect)** — the one element that differs is the one most remembered. Use deliberate, single-point differentiation for emphasis.

### 4.2 Decision & choice
- **Hick's Law** — decision time increases with the number and complexity of choices. Reduce options and complexity for faster decisions; keep high-traffic actions short.
- **Choice Overload** — too many options overwhelms. Curate, default, and defer.
- **Goal-Gradient Effect** — people accelerate as they approach a goal. Show progress toward completion (progress bars, step indicators).
- **Paradox of the Active User** — users don't read manuals; they start using immediately and learn by doing.
- **Zeigarnik Effect** — uncompleted tasks are remembered better; progress states keep people engaged.

### 4.3 Effort & interaction cost
- **Fitts's Law** — time to acquire a target depends on its distance and size. Make important targets **big** and **close** (e.g., primary action near the cursor, large hit areas, edge/corner targets are easy).
- **Doherty Threshold** — productivity soars when system and user interact at a pace under 400ms; neither should wait on the other.
- **Pareto Principle (80/20)** — roughly 80% of effects come from 20% of causes. Focus polish on the 20% of flows users actually use.
- **Parkinson's Law** — tasks inflate to fill the time available. Default "one-click" over "five-clicks."
- **Tesler's Law (Conservation of Complexity)** — every process has irreducible complexity; the designer decides where it lives.

### 4.4 Memory & cognition
- **Miller's Law** — working memory holds ~7±2 items. Chunk information; keep displays simple.
- **Chunking** — group information into meaningful wholes (phone numbers, steps) to aid memory.
- **Cognitive Load** — reduce the mental resources needed to understand and interact. Less is more.
- **Recognition vs. Recall** — present options; don't force retrieval from memory.
- **Serial Position Effect** — people best remember the first and last items in a series. Put key info/actions at beginnings and ends.
- **Mental Model** — users carry expectations from other products; match them (Jakob's Law).

### 4.5 Memory of experience & judgment
- **Peak-End Rule** — people judge an experience by its peak and its end. Design the emotional peak and the closing moment deliberately.
- **Aesthetic-Usability Effect** — aesthetically pleasing design is perceived as more usable.
- **Postel's Law (Robustness)** — be liberal in what you accept, conservative in what you send. Tolerate flexible input; emit predictable output.
- **Cognitive Bias** — acknowledge biases (anchoring, default bias, loss aversion) in pricing, defaults, and framing.

---

## 5. Information Architecture & Page Structure

### 5.1 Narrative architecture
Build a page as an **argument**, not a component catalog:
1. State the promise (what the user gets).
2. Show the product/outcome.
3. Explain the most differentiating capabilities.
4. Prove the claim with evidence.
5. Resolve risk/uncertainty.
6. Present a clear next action.

For short campaigns, compress to: **promise → proof → action.**

### 5.2 Homepage fundamentals (NNGroup)
1. **Easy access to the homepage** — every page links home; simple predictable URL; homepage visually distinct.
2. **Communicate who you are and what you do** — logo top-left, a tagline that states purpose, unique value, accurate imagery.
3. **Reveal content through examples** — most important content above the fold; concrete examples of what's inside.
4. **Prompt actions and navigation** — descriptive link labels, clear hierarchy for high-priority tasks, primary nav in an obvious place.
5. **Keep homepages simple** — standard patterns, minimal motion, immediate access, no splash screens or popups (unless legally required).

### 5.3 Page section patterns
- **Hero:** one dominant message + one primary action per viewport. Headline width ~8–16 words per line depending on size; max three hierarchy layers (eyebrow, headline, support/action); avoid carousels.
- **Feature chapter:** eyebrow → claim → one explanatory paragraph → one dominant demonstration. Alternate composition only to support rhythm; don't mechanically zig-zag every row.
- **Bento grid:** only for genuinely parallel capabilities; one dominant tile, a couple medium, the rest small; shared baseline, radius, surface language.
- **Metric band:** 2–4 verified metrics with units, time frames, comparison bases; never fabricate counters.
- **Testimonial:** specific outcome, real attribution, cleared portrait/logo. One strong quote beats a rotating carousel.
- **Comparison tables:** keep row labels visible, support keyboard/screen-reader, stack on mobile.
- **Conversion ending:** reiterate the outcome in new, shorter language; one primary CTA + at most one lower-emphasis alternative; address the last objection nearby.

### 5.4 Storytelling rules
- Show the product working rather than describing it.
- Use scroll-linked sequences only when scrolling explains progression or cause-and-effect; keep 1–3 sticky scenes max, never a whole page.
- Keep explanatory text adjacent to the visual it describes.
- Provide static fallbacks for reduced motion, low power, narrow viewports.

---

## 6. Layout, Grid & Composition

- **Use a grid, but treat it as a tool, not a religion** (Refactoring UI: "Grids are overrated"). Break the grid deliberately for emphasis.
- **Recommended default:** 12-column desktop grid (20–32px gaps, max width 1200–1440px), 8-column tablet, 4-column mobile (16px gutters, 12–16px gaps).
- **Cap content widths:** wide ~1440px, standard ~1200px, reading ~45rem (720px). Let backgrounds and media extend full-bleed while content stays capped.
- **Center only when it serves the moment.** Mix centered hero moments with left-aligned explanatory chapters; avoid centering every section.
- **Don't fill the whole screen** (Refactoring UI). Whitespace creates emphasis and confidence.
- **"Start with too much white space"** and remove it only where content needs relationship.
- **Use optical alignment** for rounded or diagonal shapes when mathematical alignment looks off.
- **Control line length:** body text 45–75 characters per line, target 60–68. Never let lines run full width on wide screens.
- **Vertical rhythm:** major chapters get 96–160px desktop section padding (64–96px mobile); increase space at *conceptual* boundaries, not after every element.
- **Balance weight and contrast:** hierarchy comes from size + weight + color together; don't over-rely on size alone.
- **Separate visual hierarchy from document hierarchy:** how things look is not the same as heading structure (though both matter).

---

## 7. Spacing & Density

- **Use an 8px base system** with a small ladder of semantic tokens. Common ladder: `4, 8, 12, 16, 24, 32, 48, 72, 96, 144`.
- **Establish a spacing and sizing system** early (Refactoring UI) — arbitrary values create noise; discrete steps create rhythm.
- **Avoid ambiguous spacing:** the gap between two elements should make their relationship obvious (tighter = grouped, looser = separated).
- **Component padding should be consistent** across repeated instances.
- **Density decision:** marketing/editorial = generous space; dense data tools = tighter space. Pick per context and stay consistent within it.
- **Touch/click affordance:** ensure interactive elements are 44×44px minimum hit area (Apple/USWDS), even when the visual is smaller.
- **"Keep internal padding of a component consistent"** — spacing is part of the component's identity.

---

## 8. Typography

### 8.1 Typefaces
- **Use at most two font families and three weights** unless the brand demands more (Apple-like restraint).
- Default premium stacks: `Inter`, `Geist`, `Manrope`, or system UI (`ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
- Pair one sans with one serif only for an editorial/display role (e.g., Instrument Serif, Newsreader); limit serif to hero/display text.
- Use monospace only for data, code, or labels.
- **Verify licenses** before declaring `@font-face`; don't bundle proprietary fonts (SF Pro) you don't own rights to.

### 8.2 Type scale
- Use a fluid scale (`clamp()`) rather than fixed sizes; establish a small, curated scale (not every value from 10–100px).
- Typical premium scale: micro 12–13px, small 14–15px, body 16–17px, lead 18–22px, h3 24–32px, h2 32–56px, h1 44–104px.
- **Line-height:** display 0.92–1.05; body 1.45–1.65.
- **Letter-spacing:** negative tracking (−0.02em to −0.045em) on large sans headings only; normal or slightly positive on uppercase labels; don't tighten body text.
- **Font weights:** 600–700 headings, 500–600 controls, 400–450 body when supported.
- **Sentence case by default;** all-caps only for short metadata labels.

### 8.3 Readability
- Body copy at 45–75 characters per line (target 60–68).
- Keep display type for headlines; **do not use display type for long paragraphs**.
- **Baseline alignment, not center:** align text blocks by baseline where possible for clean rhythm.
- **Line-height is proportional:** larger type needs tighter line-height; small type needs looser.
- Use `text-wrap: balance` for headings and `text-wrap: pretty` for prose as progressive enhancement.
- Prevent widows and single-word final lines; don't hard-code `<br>` unless an editorial break is truly needed.
- **Not every link needs a color** (Refactoring UI): distinguish links by weight, underline, or position when color is otherwise needed for meaning.
- **Don't use grey text on colored backgrounds** — grey becomes illegible; use lighter tints of the background color instead.

### 8.4 Sizing guidance by context
- Navigation links: 12–14px medium.
- Body: 16–17px desktop, 16px mobile (never below 16px for inputs).
- Footers: keep 14px+ for body where possible.

---

## 9. Color

### 9.1 Token structure
- Define **semantic tokens**, not section-specific hex values: `bg`, `surface`, `ink`, `muted`, `rule/border`, `accent`, `accent-hover`, `focus`, `error`, `success`, `warning`.
- Keep ~85% of a premium experience neutral; use one accent hue.
- Use **near-black** (`#1D1D1F`-ish) instead of pure black for large light surfaces; pure black for cinematic dark scenes.
- **Greys don't have to be grey** (Refactoring UI): tint your neutrals with a hint of your brand hue to avoid dead grey.
- **Define your shades up front** — you need more colors than you think (light backgrounds, borders, muted text, hover states, etc.). Use 10-step scales.
- **Ditch hex for HSL** when authoring palettes — it's easier to reason about hue/saturation/lightness.

### 9.2 Usage rules
- One accent for emphasis; use it consistently (buttons, links, active states).
- **Don't rely on color alone** — pair color with icon, text, pattern, or position (WCAG + Nielsen #8).
- **Contrast:** WCAG AA — 4.5:1 for normal text, 3:1 for large text (≥18.66px bold / ≥24px), 3:1 for UI components and graphics. Aim for higher on small text.
- **Accessible doesn't have to mean ugly** (Refactoring UI): design accessible colors from the start rather than degrading designs later.
- **Don't let lightness kill your saturation:** as you lighten a color for backgrounds, keep saturation reasonable so it doesn't turn muddy/grey.
- Restrict gradients to lighting, material, or depth — not arbitrary decoration.
- Alternate background tone only to mark a meaningful chapter change.
- Never encode state with color alone; test contrast in every color usage.

### 9.3 Recommended premium palette (default)
- Background `#F5F5F7` (off-white), Surface `#FFFFFF`, Ink `#1D1D1F`, Muted `#6E6E73`, Rule = ink at ~14% opacity, Accent `#0071E3` (hover `#0077ED`), Focus `#0066CC`.
- Monochrome utility palette: Ink `#0A0A0A`, Ink-soft `#5F5F63`, Ink-faint `#8A8A90`, Paper `#FFFFFF`, Paper-warm `#F7F7F5`, Surface `#F1F1EF`, Line `rgba(10,10,10,0.11)`.

---

## 10. Depth, Shadows & Elevation

- **Emulate a light source** (Refactoring UI): shadows should imply a consistent light direction; cards raised toward the light get stronger bottom shadows.
- **Use shadows to convey elevation:** higher elevation = softer, larger, more diffuse shadow.
- **Shadows can have two parts:** a tight, darker contact shadow and a larger, softer ambient shadow.
- **Even flat designs can have depth:** depth comes from layering, borders, and tonal contrast, not just shadows.
- **Start subtle:** e.g., `0 12px 40px rgba(0,0,0,0.08)` as an upper bound for floating surfaces; reduce in most cases.
- **Prefer border OR shadow, not both at max strength.**
- **Overlap elements to create layers** — overlap implies depth and hierarchy.
- **Elevation tokens:** define discrete elevation levels (rest, hover, raised, overlay) rather than arbitrary per-element shadows.
- **Hover:** raise a card 1–4px (translateY) and deepen shadow; keep movement subtle.

---

## 11. Imagery & Media

- **Use good photos** (Refactoring UI): mediocre photos destroy premium feel; use authentic, consistent art direction.
- **Lead with one high-resolution focal asset** whose subject remains legible at mobile crops; use `object-position` per breakpoint.
- **Provide explicit width/height or `aspect-ratio`** to prevent layout shift.
- **Maintain consistent aspect ratios** within repeated card rows.
- **Text needs consistent contrast over images:** use scrims/gradients deliberately; keep them subordinate to the image.
- **"Everything has an intended size"** — an image that's too small to read its content is a placeholder; size imagery to its job.
- **Beware user-uploaded content** — design graceful fallbacks (crops, aspect-ratio boxes, placeholders).
- **Device frames sparingly** and match perspective, lighting, and shadow across scenes.
- **Performance:** AVIF/WebP where supported; sensible `srcset`/`sizes`; lazy-load below the fold but preload the LCP hero image when measurement justifies it.
- **Alt text:** descriptive for informative media; empty `alt=""` for decoration.

---

## 12. Icons

- **Use one coherent icon family or custom SVG language** across the product.
- Default: 20–24px icons, 1.5–2px stroke for controls; larger, simpler icons for marketing.
- **Optically align icons with labels** and preserve a 44px interactive hit area.
- **Never use emoji as interface icons.**
- Hide decorative SVGs from assistive technology (`aria-hidden`); label icon-only buttons with accessible names.
- Icons should be **recognizable at a glance**; test at small sizes.
- Use icons to support meaning, not to decorate text that already says the same thing.

---

## 13. Buttons & Action Triggers

This is one of the most detail-dense areas. Rules below are consensus across Apple, Material, USWDS, and practical guides.

### 13.1 Button anatomy & dimensions
- **Height:** 44–52px for primary buttons (Apple/minimum 44; Material 40dp standard / 48 touch; USWDS 44px+).
- **Horizontal padding:** 16–24px.
- **Weight:** 500–600 (medium–semibold).
- **Radius:** 10–14px standard; pill (999px) only if pills belong to the system; large radius (18–32px) for big product surfaces.
- **Hit area:** visual size may be smaller, but interactive target must be ≥44×44px.

### 13.2 Button hierarchy
- **One primary action per screen/viewport.** Primary = filled, high-contrast (usually solid brand/ink color, white text).
- **Secondary** = text link with arrow, or a restrained outline/quiet surface — never a second equally loud filled button.
- **Tertiary/ghost** = text-only, no fill, no border.
- **Never place more than two adjacent CTAs in a hero.**
- **Primary should be visually dominant** — users should never have to hunt for the main action.

### 13.3 Button states (all required)
- **Default / Rest:** filled primary, outlined secondary, or link tertiary.
- **Hover:** fill/border/tone shift; optional 1–2px lift; icon/arrow may shift 2–4px to show direction. Keep travel ≤4px, rotation ≤1–2°.
- **Active/Pressed:** less lift or a slight scale reduction (e.g., 98% scale or translate down 1–2px).
- **Focus-visible:** clear visible outline with offset; never remove outlines without a replacement.
- **Disabled:** visibly reduced opacity (e.g., ~40–50%), and if possible, **explain why** it's disabled rather than leaving users guessing; avoid disabled-only affordances on key flows.
- **Loading:** spinner replacing/adjacent to label; disable double-submission; preserve label width or lock height to avoid layout shift.
- **Success/Error** (for submit actions): brief confirmation or inline error.

### 13.4 Button copy
- **Specific and concrete:** "Explore the camera," "Start a trial," "See pricing," "Start a room" — not "Learn more" or "Submit."
- Match label length to button size; avoid ambiguous two-word labels.
- Use sentence case for labels (except short brand-allowed uppercase).
- Put the strongest verb first; state the outcome, not the mechanism.

### 13.5 Button animation
- Animate color and transform over 160–220ms.
- Press displacement within 1–2px.
- Always respect `prefers-reduced-motion`.

### 13.6 Button anti-patterns
- More than one primary CTA competing in the same view.
- Buttons that look identical but do different things.
- Tiny hit areas (<44px) wrapped in padding.
- Disabled buttons blocking users from understanding what to do.
- Pure icon buttons without accessible names or tooltips.

---

## 14. Links

- **Links should look like links** — but "not every link needs a color" (Refactoring UI); differentiate by color, underline, weight, or position consistently within your system.
- **"A link is a promise" (NNGroup):** the destination should match the expectation set by the label. Label with the destination's name/outcome, not "click here."
- **Underline links within body text** (standard) unless color alone provides clear affordance at sufficient contrast.
- **Keep link hover/focus/visited states** distinguishable; never rely on hover alone for discoverability.
- **Use real links for navigation** (semantic `<a>`), not divs; they get keyboard access, focus, and screen-reader announcements for free.
- **Open in a new tab sparingly** and signal it with an icon when you do; don't break back-button behavior.

---

## 15. Forms & Inputs

- **Labels:** always visible labels above inputs (not placeholder-as-label). Placeholders are examples, not labels.
- **Control height:** 44–52px; mobile input text ≥16px (prevents iOS zoom).
- **Clear focus rings** on all inputs; inline error association (error message + `aria-describedby`).
- **Group related inputs** visually and logically; explain constraints *before* submission.
- **Preserve entered data** after validation errors — never wipe the form on error.
- **Keep marketing forms short:** ask only what's required at the current step.
- **Good defaults** reduce effort (IBM): prefill when appropriate.
- **Validate inline where possible** and communicate progress (green check, subtle messaging) without being noisy.
- **Error messages:** plain language, precisely indicate the problem, constructively suggest a solution (Nielsen #9); no raw error codes.
- **Inputs: consistent borders/radii** within the system; use hairline borders; visible disabled state.
- **Auto-focus** the first field in critical forms; set sensible tab order.
- **Support Enter-to-submit**, correct `type` attributes (email, number, tel, date), and `autocomplete` where helpful.

---

## 16. Navigation, Headers & Menus

### 16.1 Header
- **Desktop height:** 44–52px global nav (64–72px if the brand mark demands it).
- **Mobile height:** 48–56px; menu trigger ≥44×44px.
- **Static by default**; sticky only when persistent nav improves the journey.
- **Surface:** transparent over a clean hero; transition to translucent (e.g., `rgba(255,255,255,0.78)` + `backdrop-filter: saturate(180%) blur(18px)`) after scroll, only when underlying content stays readable; provide opaque fallback.
- **Layout:** brand left, primary links centered/adjacent, high-priority action right; keep the CTA compact.
- **Active state:** weight, tone, or small indicator — never hover alone.
- **Divider:** 1px low-contrast rule only after the header gains a surface.

### 16.2 Menus & dropdowns
- Real button with `aria-expanded` / `aria-controls`; Escape closes; focus returns to trigger; background scroll locked safely.
- Trap focus only for modal/full-screen drawers.
- Animate opacity + small translation over 180–320ms; avoid dramatic scale/rotation.
- Keep menu items concise; group logically; support keyboard arrow navigation.
- Never hide essential content behind hover.

### 16.3 General navigation principles
- **Navigation should be obvious, compact, and usable without hover** (Apple-like).
- Keep labels short and descriptive; avoid jargon and made-up words.
- Consistent focus order between desktop and mobile variants.
- Anchor jumps must account for sticky-header height (`scroll-margin-top`).
- If the header hides on scroll, reveal it on upward scroll or keyboard focus.

---

## 17. Cards, Surfaces & Containers

- **Use cards only when items are siblings or independently actionable** — don't make every page a card wall.
- **Radius:** 12–20px default; 24–32px for large image-led modules.
- **Prefer a subtle border OR a subtle shadow**, not both at max strength.
- **Don't nest more than two visibly styled surfaces.**
- **Card anatomy:** consistent internal padding, consistent image aspect ratios within rows, clear separation between title/body/action.
- **Hover:** raise 1–4px with deepened shadow; indicate interactivity subtly.
- **Avoid "wall-to-wall cards"** — use type, whitespace, rules, imagery, and background shifts to establish hierarchy instead.
- **Vary card scale and purpose** (Refactoring UI): a single comparison, workflow, or demo often communicates more than six identical icon cards.

---

## 18. Dialogs, Modals & Overlays

- **Only use a modal when the task is short and interruption is justified** (focus is on one decision). For long tasks, prefer a page or full-screen flow.
- **Keyboard:** Escape closes; focus moves into the dialog on open and returns to the trigger on close; trap focus while open.
- **Accessible name:** dialog has a clear title and role (`role="dialog"`/`aria-modal`).
- **Dismissal:** explicit Close button plus Escape; click-outside may close only when loss isn't destructive (avoid losing form data on accidental outside click without confirmation).
- **Backdrop:** dim enough to signal modality but not obscure everything; keep contrast for the dialog.
- **Scale:** standard max width ~480–560px for small dialogs; avoid dialogs taller than the viewport.
- **Buttons in dialogs:** place the primary action where users look (bottom-right on desktop, stacked on mobile); make destructive actions clearly dangerous.
- **Never open a modal automatically on page load** (NNGroup homepage principle) unless legally required.
- **Focus order:** first focusable element on open; ensure tab order cycles within the dialog.

---

## 19. Feedback: Toasts, Alerts, Errors & Empty States

### 19.1 Feedback types
- **Toast/Snackbar:** transient, for confirming a completed action; short text; auto-dismiss (~4–6s) with manual dismiss; never critical info only in a toast.
- **Inline error:** next to the field; red/bold text; plain language; precise problem + constructive fix (Nielsen #9).
- **Inline validation:** validate on blur/change; don't punish while typing; positive confirmation with green check where useful.
- **Alerts/banners:** for system-level or persistent info; distinguishable severity (info, success, warning, error) — not by color alone.
- **Empty states:** explain what belongs here, why it's empty, and the next action (Refactoring UI: "don't overlook empty states"). Use helpful illustration sparingly.

### 19.2 Rules
- **Feedback should be immediate** — no action with consequences should go unacknowledged (Nielsen #1).
- **Closure (Shneiderman #4):** complete task sequences should feel finished — clear success/confirmation at the end of a flow.
- **Progress:** for operations > a few seconds, show progress; keep the user informed of status.
- Keep messaging calm and specific; avoid blame ("you entered…" vs "that email isn't valid").
- Preserve user data through errors; always offer a path forward.

---

## 20. Motion & Microinteractions

### 20.1 Purpose
- **Motion must have a job** (Material): explain cause, preserve object identity, reveal state, direct attention, or provide delight. Remove motion that just proves animation is possible.
- **Motion priority order:** (1) immediate response to input, (2) state transition & continuity, (3) orientation during navigation, (4) guided attention, (5) atmosphere.
- **The page must remain fully understandable and operable with all motion disabled.**

### 20.2 Timing system (tokens)
- Hover/press: **120–220ms**.
- Menus, tooltips, toggles, local state: **180–320ms**.
- Section reveals: **400–700ms**.
- Large cinematic transitions: up to **900ms** — only when the user isn't waiting for control.
- Stagger repeated items by **40–90ms**, cap total sequence near **500ms**.
- Standard easings: `cubic-bezier(.16,1,.3,1)` (ease-out-expo) and `cubic-bezier(.2,.8,.2,1)` (standard); avoid constant linear motion except for truly mechanical parts.
- **Animate `opacity` and `transform`;** avoid layout-triggering properties (width, height, top, margin) on large regions.

### 20.3 Interaction levels (art-directed hierarchy)
1. **Signature:** one memorable transition that expresses the concept.
2. **Structural:** navigation, section entry, object continuity.
3. **Local:** hover, focus, press, drag, toggle, validation.
4. **Ambient:** optional, quiet, cheap loops (grain, light).
- Spend the motion budget on signature + structural; keep local fast and legible.

### 20.4 Scroll & reveals
- Default reveal: opacity 0→1 and translateY 12–24px→0.
- Trigger once when 15–30% of the element enters the viewport.
- Keep headings and their supporting text temporally grouped.
- Reveal groups/compositions, not every paragraph, icon, or divider.
- Never hide SEO-critical or readable content permanently if JS fails.
- Avoid scroll-jacking, forced smooth scrolling, and long pinned sequences without informational value.

### 20.5 Pointer behavior
- Enable pointer-reactive effects only for `(hover: hover) and (pointer: fine)`.
- Good uses: bounded highlight over a surface, 1–2° tilt, small magnetic translation, subtle background offset.
- Normalize and clamp pointer coordinates; smooth toward the target rather than mapping raw movement.
- Reset cleanly on pointer leave; keep hit targets stationary even if artwork moves.
- **Custom cursor only when the concept requires it** — never by default; no cursor trails; keep native cursor on touch/coarse/reduced-motion contexts.

### 20.6 Reduced motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```
- Also skip pointer tracking, parallax, autoplay movement, animated blur, and continuous transforms in JS.
- Provide the final static state of any animated explanation.

---

## 21. Responsive Design & Breakpoints

- **Design behavior, not screenshots** — add breakpoints when content requires them. Typical starts: 480, 768, 1024, 1280.
- **Mobile:** preserve the thesis, priority, and focal asset; reduce decoration and choreography; redesign composition rather than simply stacking (mobile is a separate composition using the same concept).
- **Tablet:** treat as its own composition when a split hero becomes cramped.
- **Desktop:** use extra width for relationship and scale, not just to enlarge everything.
- **Wide desktop:** cap reading and control widths; let backgrounds/media extend.
- **Short viewports:** prevent sticky scenes or oversized heroes from trapping content below controls.
- **Navigation:** collapse before links wrap or collide — not at an arbitrary device label.
- **Type:** use fluid `clamp()` scales but bound them so user-zoomed text doesn't explode the layout.
- **Media:** per-breakpoint crops and safe subject positions.
- **Test at minimum:** 360×800 & 390×844 phones, 768×1024 tablet, 1280×800 laptop, 1440×900 desktop, and one width between each declared breakpoint.
- **Touch:** 44×44px targets; hover styles inside `@media (hover:hover)`; avoid horizontal gesture conflicts with browser nav.

---

## 22. Accessibility

Accessibility is not a feature — it's **usability for the broadest possible audience** (USWDS: "Accessibility affects everybody; build it into every decision").

### 22.1 Core requirements
- **Semantic HTML** and native controls (buttons, links, inputs, landmarks) first; custom widgets only with full ARIA and keyboard support.
- **Keyboard complete:** every interactive element reachable and operable by keyboard; visible focus states; logical tab order.
- **Contrast:** WCAG AA (4.5:1 normal text, 3:1 large text/UI); verify against both light and dark sections.
- **Text:** resize to 200% without clipping or broken layout; no text hidden behind hover.
- **Labels:** descriptive labels and headings; `aria-label` for icon-only buttons; `alt` for meaningful images, empty for decorative.
- **Never encode state with color alone** (add icons, text, pattern).
- **Reduced motion** as above.
- **Focus visibility:** clear outline with offset on every interactive element — including against images and colored backgrounds.
- **Coarse pointers:** don't require hover to reveal essential content or actions.

### 22.2 Assistive-tech specifics
- Dialogs/menus: manage focus, Escape, `aria-expanded`, `aria-controls`, restore focus.
- Forms: inline errors with `aria-describedby`, error summary links.
- Tables: proper `<th scope>` and headers.
- Headings: logical single-hierarchy order (h1 → h2 → h3), never skip for styling.
- Screen readers: hide decorative SVGs; announce dynamic updates (`aria-live`) for toasts/status.

### 22.3 Inclusive design (Microsoft)
- Design with a range of abilities from the start — it produces better solutions for everyone.
- Test with real users, including people with disabilities, throughout development.

---

## 23. UX Writing & Content

### 23.1 Principles
- **Put the customer outcome in the headline and the mechanism in the support copy.**
- **Speak like a human (GitHub):** plain, direct, warm language — no corporate-speak.
- **Mind your words, they are important (GitHub):** terminology is part of the interface.
- **Short Anglo-Saxon verbs and concrete nouns:** "Start," "Send," "Show," not "Initiate," "Leverage," "Facilitate."
- **Sentence case by default.**
- **Length targets:** eyebrows 2–5 words; headlines ~3–12 words; feature descriptions 1–3 sentences; body copy concise.
- **Use numbers only when verifiable:** "exports a 4K draft in under two minutes" beats "super fast."
- **Avoid empty marketing words:** "revolutionize," "seamless," "next-generation" — replace with a specific capability or result.
- **Write for scanning:** front-load key words; use bullets; make headings descriptive.
- **Consistent terminology** across the whole product (Nielsen #4, Shneiderman #1).

### 23.2 Voice
- Adopt one voice and keep it consistent; match it to the product's personality (serious tools = calm and confident; playful tools = warm and witty).
- Error messages should be empathetic and solution-oriented, never blaming.
- Button labels: concrete verbs describing the result of clicking.

---

## 24. Design Tokens & Design Systems

### 24.1 Design tokens
- **Tokens are the discrete palette of values** from which all visual design is built (USWDS) — a limited set of options, like a musical scale.
- Define tokens for: color (semantic, not raw hex), type (family, size, weight, line-height), spacing, radii, borders, shadows/elevation, motion (duration, easing), z-index, and container widths.
- **Semantic naming** (e.g., `--color-accent`, `--space-4`, `--elevation-2`) so intent survives value changes and themes.
- Keep the token set small and opinionated — a token nobody can use is a liability.

### 24.2 Design-system principles
- **Systematic (Figma):** leverage reusable blocks to build complex things.
- **Predictable (Figma):** respect the system; add new patterns mindfully.
- **Unified (Airbnb):** every piece contributes to the whole at scale; no isolated features or outliers.
- **"Anything added dilutes everything else" (GitHub)** — every component/token added to a system costs attention.
- **Atomic structure:** tokens → primitives (buttons, inputs) → components → patterns → templates → pages.
- A design system is a **shared language** between design and engineering; document states, not just happy paths.

### 24.3 Restraint budget
- One accent hue, one display typeface, one signature motion motif, and one surprising composition per page.
- Don't make every section compete.

---

## 25. Anti-Patterns (What Top Teams Avoid)

- A hero followed by six identical three-card rows.
- A "trusted by" strip with invented logos.
- Scroll hijacking, mandatory intro animations, hidden cursors.
- Parallax on body copy.
- Auto-advancing carousels.
- Decorative dashboards filled with fake data.
- Repeated centered headings that flatten page rhythm.
- Arbitrary "Learn more" links with no destination context.
- A final CTA that introduces a new promise or audience.
- Wall-to-wall cards; excessive purple "AI" gradients; glass cards everywhere; floating blobs; tiny grey text; uniformly rounded containers.
- Oversized headings that wrap into awkward one-word lines.
- Using hover to hide essential content or actions.
- Disabled states without explanation; hidden focus outlines.
- More than one primary CTA competing in a view.
- Color-only state encoding (fails accessibility).
- Placeholder text as labels.
- Excessive icon cards that repeat the same message.
- Autoplay audio; perpetual decorative motion; cursor trails.

---

## 26. Final QA Checklist

Run through every screen with these questions (adapted from the monochrome & premium skill QA standards):

**Composition**
1. What is the one idea of this section?
2. What should the eye see first?
3. Does the product prove the copy?
4. Does the motion explain anything?
5. Can one element be removed?

**Engineering/visual QA**
- No horizontal overflow at any breakpoint.
- Text does not clip at 200% zoom.
- Every interactive element traversable by keyboard.
- Focus indicator visible on light and dark sections.
- Contrast verified for text, controls, meaningful borders.
- Menus/dialogs manage focus and Escape correctly.
- Loading, empty, error, success, disabled, selected states all exist where relevant.
- Links have real destinations; buttons perform real actions.
- No console errors; stable aspect ratios; modern image formats; lazy-load below fold.
- Animations smooth under CPU slowdown; no layout shift.
- Reduced motion: experience still communicates every state.
- Screenshots captured after fonts/images load; mobile vs desktop hierarchy is intentional.

---

## 27. Sources

Primary research for this document was drawn from:

- **Apple Human Interface Guidelines** — https://developer.apple.com/design/human-interface-guidelines
- **Material Design (Google)** — https://m3.material.io
- **Fluent 2 (Microsoft)** — https://fluent2.microsoft.design
- **IBM Carbon / IBM Design Principles** — https://carbondesignsystem.com, https://www.ibm.com/design
- **Airbnb Design** — "Building a Visual Language" — https://airbnb.design/building-a-visual-language
- **GitHub Primer / Zen of GitHub** — https://primer.style/product/getting-started
- **Figma Design Principles** — https://www.figma.com
- **US Web Design System (USWDS)** — https://designsystem.digital.gov
- **Nielsen Norman Group** — 10 Usability Heuristics, Homepage Design: 5 Fundamental Principles — https://www.nngroup.com
- **Laws of UX (Jon Yablonski)** — https://lawsofux.com
- **Refactoring UI (Adam Wathan & Steve Schoger)** — https://www.refactoringui.com
- **principles.design** — real-world design principles library — https://principles.design
- **Design Principles FTW** — design principles collection — https://www.designprinciplesftw.com
- **Don Norman — The Design of Everyday Things**; **Ben Shneiderman — Designing the User Interface**; **Dieter Rams — Ten Principles for Good Design**; **Google PAIR** — https://pair.withgoogle.com

> Synthesis note: This document combines and normalizes guidance from the above sources. Where sources conflict, the rules above represent the strongest consensus among premium design systems (Apple, Material, Fluent, USWDS) and practical guides (Refactoring UI). Always adapt to your specific brand, audience, and platform.
