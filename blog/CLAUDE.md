# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This directory holds the Distill-format web article for the paper *"Inside the Machine: A Technical
Analysis of X's 2026 Recommendation Algorithm."* It is self-contained: the experiment notebooks in
the parent directory share no code or build system with it.

- `main/` — the article (`index.html`, `bibliography.bib`, `assets/`, `Makefile`). **Untracked in git
  so far.**
- `template/` — git submodule of [`distillpub/template`](https://github.com/distillpub/template), the
  Distill web-component framework.

## Where edits go

**All edits are made in `main/`. Never edit anything under `template/`.**

`template/` is a read-only upstream checkout. Refer to it freely — read
`template/src/components/d-*.js` to see how a component actually behaves, what markup it generates,
or which CSS it injects, and copy files or snippets out of it into `main/` — but no change belongs in
that tree. If a component's default behavior is wrong for this article, override it from `main/`
(CSS in the `<style>` block, markup or script in `index.html`), don't patch the source.

This means `make template` should not normally be needed: it exists to rebuild the framework after a
`template/src/**` change, and there are none. `main/template.v2.js` is a build artifact copied in
from `template/dist/` — gitignored, regenerated, and never hand-edited either.

## Commands

All run from `main/`:

```
make serve      # python3 -m http.server 8080 — edit index.html and reload; content changes need no build
make render     # node ../template/bin/render.js -i index.html -o dist/index.html
make template   # npm install + rollup build in ../template, then copy dist/template.v2.js here
make clean      # rm template.v2.js and dist/
```

`make render` bakes math, citations, byline and TOC into static HTML for publishing.
`make template` only matters if `template/` is ever updated from upstream — see "Where edits go".
There is no linter or test suite for the article; `template/` has its own (`npm test` → mocha,
`npm run lint` → eslint) but those cover the upstream framework, not this article.

To drop the local framework build entirely, swap the script tag in `index.html` for
`https://distill.pub/template.v2.js` (the line is already there, commented out) — then no npm is
needed at all.

## How the framework build works

`template/src/components/d-*.js` defines the custom elements (`d-math`, `d-cite`, `d-code`,
`d-figure`, `d-toc`, `d-front-matter`, …). Rollup builds them into **two** bundles from two entry
points (`rollup.config.common.js`):

| Entry | Output | Used by |
|---|---|---|
| `src/components.js` | `dist/template.v2.js` | the browser — registers the custom elements at runtime |
| `src/transforms.js` | `dist/transforms.v2.js` | `bin/render.js`, run under jsdom for pre-rendering |

Worth knowing because the two paths can disagree: a component's runtime behavior lives in the first
bundle, its pre-rendered output in the second, so `make serve` and `make render` can produce
different markup for the same tag (`d-toc`, for instance, stamps `prerendered="true"` only on the
render path).

`render.js` runs `transforms.render()` (extractors for front matter / bibliography / citations, then
the HTML, TOC, byline, math, meta and reorder transforms) followed by `transforms.distillify()`,
which layers on the distill.pub site chrome.

## Gotchas in `main/index.html`

- **Keep `<distill-header distill-prerendered></distill-header>`.** `distill-transforms/distill-header.js`
  inserts a full distill.pub nav bar whenever no `distill-header` tag is found, so the empty tag is
  what suppresses it. Deleting the tag brings the nav bar back on the next `make render`.
- **The `<style>` block must stay after the template `<script>` in `<head>`.** The framework injects
  its stylesheet immediately before the first script tag in head, so only rules declared after it win
  at equal specificity. The `d-toc` overrides additionally need the `d-article >` qualifier to
  outrank the component's runtime-injected inline `display: block`.
- **The TOC is local work, not template behavior** — it's the clearest example of the override rule.
  `d-toc` ships with no layout styles, isn't in the template's grid list, and emits an always-empty
  `<nav class="table-of-contents">` plus a stray `<br>` after each h2. The docked sidebar, the
  scroll-spy that sets `.active`, and the hiding of those artifacts are all done from `index.html`.
  Two non-obvious pieces hold it together, both commented in place: `d-article` is switched from the
  template's `overflow-x: hidden` to `clip`, because `hidden` makes it a scroll container and
  silently kills `position: sticky` on children; and the sidebar's `grid-row` is set from JS to span
  the article's rows, since a sticky element can only travel inside its own grid area.
- Front matter — title, description, authors, published date, KaTeX delimiters — is the JSON inside
  `<script id="distill-front-matter">`, not HTML.
- Content sits on a named grid. `grid-column: text` is the default; `page`, `screen`, `middle` and
  `gutter` are the wider/offset options, set inline on a figure or block element.
- `d-cite key="..."` keys resolve against `bibliography.bib`, loaded by `<d-bibliography>` in the
  appendix. The bib file is still the upstream Distill sample set — replace entries as the article
  gets real citations.
- `_reference-article-test.html` and `_reference-article-no-citations.html` are upstream example
  articles kept as a component reference. `_reference-article-test.html` exercises nearly every
  component — consult it rather than guessing at a component's API.

## Submodule

`.gitmodules` (at the repo root) declares the submodule path as `blog/blog/template`, but the gitlink
is at `blog/template`. `git submodule status` / `update --init` therefore fail with "no submodule
mapping found for path 'blog/template'". Fix that path before relying on any `git submodule` command.
