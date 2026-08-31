# Design guidelines for article visualizations

This doc is for anyone (and any coding agent) building interactive figures for *Inside the
Machine: A Technical Analysis of X's 2026 Recommendation Algorithm* — the Distill-format
article in `main/`. The hero visualization (`main/assets/hero.js` + its markup/CSS in
`main/index.html`) is the reference implementation for everything below: when this doc and
that code disagree, read the code, it's newer.

Give this file to your agent verbatim before it writes a line of figure code.

---

## 1. Ground rules

- **Every number shown must come from the codebase or the shared draft — never invented.**
  The hero's counts trace to `x-algorithm/home-mixer/params/config.rs`
  (`TOP_K_CANDIDATES_TO_SELECT = 50`, `RESULT_SIZE = 35`, `MAX_POST_AGE = 48h`,
  `WHO_TO_FOLLOW_POSITION = 6`). Before drawing a count, grep for it. If a figure
  simplifies (fewer dots than real posts), say so in the caption:
  *"Dot counts are illustrative — the numbers are the code's own."*
- **Ground claims in raw source files** (Rust/Python/configs) and the authors' own drafts —
  not in generated docs or prior AI writeups sitting in the shared repo.
- **Hover annotations carry repo paths.** Every stage/module a figure names should point at
  where it lives (`home-mixer/filters/`, `vm-ranker/dpp.rs`). The figure doubles as a map
  of the codebase.
- **All edits go in `main/`. Never touch `template/`** — it's a read-only upstream checkout.
  Override behavior from `index.html`/CSS instead. (See `CLAUDE.md` for the full repo rules.)

## 2. The look, and where it comes from

The taste target is the `inspo/` folder. What we actually took from each:

- **"Inside a Neural Chameleon"** — the closest reference for a hero: light background,
  thin outlined structures, muted colored dot clouds, small mono labels, a hover card with
  a title + one explanatory sentence, canvas-rendered with a palette read from CSS,
  `prefers-reduced-motion` fallback. Its hover annotations dict is a good content model.
- **Thinking Machines ("Modular Manifolds", "Defeating Nondeterminism")** — calm, looping,
  ambient animation; restraint; the centered title → authors → date byline we now use.
- **Distill ("Communicating with Interactive Articles")** — the interaction philosophy:
  *details on demand*. The base view must read fully without interaction; hover/tap adds a
  layer, never carries the argument alone.
- **Transformer Circuits ("Circuit Tracing", "Towards Monosemanticity")** — diagrams as
  arguments: every visual element encodes a real claim about the system, nothing decorative.

One sentence to hold onto: **simple, not fancy — but deliberate and polished.** If an
element doesn't encode a fact about the system, delete it.

## 3. Palette and typography

Colors are the ysli.dev tokens, declared at the top of `main/index.html`'s `<style>` block
and mirrored in `hero.js`'s `C` object. Use these, not new ones:

| Token | Value | Use |
|---|---|---|
| ink | `#111111` | primary text, active labels |
| muted | `rgba(17,17,17,0.55)` | secondary labels |
| faint | `rgba(17,17,17,0.30)` | tertiary labels, icons |
| hair | `rgba(164,218,222,0.55)` | hairlines, structure (teal-tinted) |
| `--teal` ramp | `#8fd9de` / `#2596be` / `#0f5f7d` | things you have a relationship with (in-network, communities, graph) |
| `--accent` | `#f97316` (orange) | **reserved for the model path** — the learned components the article is about |
| ad | `#c9a227` | ads only |

The teal-vs-orange split is semantic, not decorative: relationship-based mechanisms get
teal, model-based mechanisms get orange. Keep that meaning consistent across every figure.

Type: **Berkeley Mono** for all in-figure labels (self-hosted in `main/assets/fonts/`;
prose is Iowan Old Style and stays out of figures except hover-card bodies). Label sizes
~9–13px in the figure's logical coordinates. **Sentence case everywhere — no ALL CAPS.**
Structure is drawn with 1px hairlines, small cap ticks, dotted lines for cross-system
links, rounded rects for containers.

## 4. The established visual grammar

The hero defined encodings; new figures should reuse rather than reinvent them:

- **A dot is a post.** Color = which source/path it came from.
- **Hollow ring = a bare ID; filled dot = hydrated post.** (Hydration is the transition.)
- **Vertical hairline with a label above = a pipeline stage/gate.** The active stage's
  label renders in ink while it's narrated; idle ones stay muted.
- **Removal = a pop**: the dot freezes at its death point, shrinks and fades while a thin
  ring expands from the *same center*. Removals should be legible events, optionally with a
  live counter ("− 2,100 removed").
- **Dot size after scoring = score.**
- **Database cylinder + dotted line = a store written by the offline half of the system** —
  the two halves only meet through stores; this is the article's core structural fact.
- **Dashed orthogonal route with a chevron = data flowing back** (e.g. the training-log
  loop). Orthogonal with rounded corners, not bezier swoops; label sits clear of the line.
- **Numbered phase caption (`01 · A request arrives` + one-line sub)** in the top-left
  narrates a multi-stage animation.

## 5. Architecture of a figure (the mechanics that took us time to get right)

Structure: markup in `index.html` (a `<figure>` with a `<canvas>` and a hover-card `<div>`),
all logic in one self-contained `main/assets/<name>.js` loaded with `defer`. No external
libraries, no iframes. Canvas 2D for anything with many moving elements.

Non-negotiables, each of which we learned the hard way:

1. **Deterministic time.** Every element's position is a *pure function of the cycle clock
   `t`* — nothing accumulates per-frame `dt`. Otherwise dropped frames desync the animation
   from its narration. Derive narration/caption switch times *from the same kinematics*
   (e.g. "phase starts when 30% of dots have crossed the gate"), never hand-tuned constants.
2. **Fixed logical coordinate system** (hero: 1160×590), scaled to the canvas via
   `setTransform`. All geometry, hit regions, and labels live in logical units.
3. **DPR, uncapped, and re-rasterized on zoom.** Backing store = `cssWidth ×
   devicePixelRatio` (no cap — capped canvases look soft next to DOM text), plus a
   `matchMedia('(resolution: …dppx)')` listener re-rendering on browser-zoom changes.
4. **Resizing a canvas wipes it** — remember the last rendered `t` and repaint after every
   resize, or static/paused frames go blank.
5. **`ctx.font` does not trigger `@font-face` loading.** Call
   `document.fonts.load('400 11px "Berkeley Mono"')` (and the bold face) at boot or the
   canvas silently renders a fallback font.
6. **`prefers-reduced-motion`**: render one informative static frame (pick a mid-cycle `t`
   where every stage is populated) instead of animating. Re-render it on resize and when
   fonts finish loading.
7. **Pause offscreen** with an IntersectionObserver; resume on re-entry.
8. **Guard for `make render`**: bail early if `canvas.getContext('2d')` returns null
   (jsdom). Run `make render` before pushing; it must pass.
9. **Ship a dev hook**: `window.__<name>Render(t)` that freezes the loop and renders one
   moment — indispensable for iterating on late-cycle states and for agent screenshot
   verification (`__heroRender(7200)` is the model).
10. **Accessibility**: `role="img"` + a full `aria-label` on the figure describing what the
    animation shows; a `<figcaption>` that ends with the take-away and mentions the hover
    affordance.

## 6. Hover cards

- Content pattern per region: **title** (mono, bold) → **body** (serif, one or two
  sentences, states a fact) → **repo path** (mono, faint, separated by a hairline).
- **Hit regions must be contiguous** — each stage owns the space halfway to its neighbors.
  Narrow strips with dead gaps make the card flicker as the pointer sweeps.
- **Follow physics**: pointer moves only update a target; the card eases toward it with
  frame-rate-independent exponential smoothing (`k = 1 − e^(−dt/70)`) stepped **inside the
  same rAF loop that draws the canvas** (one clock — CSS transitions retargeted per
  mousemove rubber-band, and animating `left/top` jitters against the canvas). Paint via
  `transform: translate3d` with `will-change: transform` only.
- Cache the card's measured size when its content changes; never read `offsetWidth` per move.
- Snap (don't glide) on first appearance; flip to the pointer's other side near edges;
  clamp inside the figure. If the main loop isn't running (reduced motion), track directly.
- **Don't change the cursor** — no `help` question mark.
- `pointerdown` mirrors `pointermove` so tap works on touch.

## 7. Page conventions (so figures sit well in the article)

- Grid: figures usually take `grid-column: screen` with a max-width (hero: 1360px) or
  `page`; prose stays in `text`. `d-title` children need an explicit `grid-column`.
- The `<style>` block must stay *after* the template `<script>` in `<head>` (the framework
  injects its stylesheet before the first script — later rules win ties).
- Don't animate `transform` on `d-article` or any ancestor of the sticky TOC — it un-sticks
  while animating. Page-level entrances are opacity-only with zero delay; small
  `translateY` rises are for the top matter only.
- `scroll-behavior: smooth` must stay class-gated (`html.smooth-scroll`, added after
  `load`) or refreshing mid-article visibly glides down from the top.
- Loop lengths: long enough to narrate (~18s for 8 phases), soft fade-out and re-seeded
  restart. Chrome (structure, labels, panels) persists; only dynamic content fades.

## 8. Working loop

```
cd blog/main && make serve        # http://localhost:8080 — edit + reload, no build step
```

Iterate with the browser open. For an agent: after each meaningful change, reload, call the
figure's `__<name>Render(t)` hook at 2–3 key moments, screenshot, read the console for
errors, and *look at the result* before moving on. Zoom into screenshots to check label
alignment and that effects (pops, ticks) are centered on the elements they belong to.
Before handing off: one full uninterrupted loop watched end to end, hover sweep across the
whole figure, `make render` passes, no console errors.

## 9. Definition of done

- [ ] Every drawn number traced to a source file (or marked illustrative in the caption)
- [ ] Encodings consistent with §4; palette and semantic teal/orange split respected
- [ ] Sentence case; Berkeley Mono loaded via `document.fonts.load`
- [ ] Deterministic in `t`; narration derived from kinematics; survives dropped frames
- [ ] Full-DPR rendering + zoom re-rasterization; resize repaints
- [ ] Reduced-motion static frame; offscreen pause; jsdom guard; `make render` passes
- [ ] Hover cards: contiguous regions, repo paths, transform-based follow, no cursor change
- [ ] `role="img"` + `aria-label` + figcaption with take-away
- [ ] Dev hook exposed; one full loop verified by eye
