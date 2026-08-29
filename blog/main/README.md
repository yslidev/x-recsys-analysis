# Blog (Distill template)

The article lives in `index.html` and is rendered by the [Distill](https://github.com/distillpub/template)
web components, built from the `../template` submodule.

## Run it

```
make serve          # http://localhost:8080
```

Then edit `index.html` and reload. No build step is needed for content changes.

To produce a static, pre-rendered copy for publishing (math, citations, byline and
table of contents baked into the HTML):

```
make render         # writes dist/index.html
```

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The article. Front matter (title, authors, date) is the JSON block near the top. |
| `bibliography.bib` | BibTeX entries. `<d-cite key="...">` looks up keys here. |
| `assets/` | Images and other static files. |
| `template.v2.js` | Built Distill bundle (gitignored — regenerate with `make template`). |
| `_reference-*.html` | Copies of the upstream example articles, kept as a component reference. |

## Editing the framework itself

`template.v2.js` is compiled from `../template/src`. After changing anything there:

```
make template       # npm install + rollup build + copy the bundle in
```

To skip the local build entirely, swap the script tag in `index.html` for the published bundle:

```html
<script src="https://distill.pub/template.v2.js"></script>
```

## Table of contents

`<d-toc>` is the first child of `<d-article>` and is built automatically from the
`id`s on your `h2`/`h3` elements — **give every heading an `id`** or it won't be
linkable. Add `no-toc` to a heading to leave it out.

Behaviour, all driven from `index.html` (styles in `<head>`, scroll-spy script at
the bottom of `<body>`):

- **≥1000px** — docks in the left margin beside the text, sticky at 1.5rem from
  the top. Distill's section-number markers are hidden at this width since the
  sidebar occupies the same column.
- **<1000px** — falls back to an inline block above the article; markers return.
- The entry for the section you're reading is highlighted, updated on scroll.
  A single side bar (`.toc-indicator`) glides between entries rather than each
  link flicking its own border on and off; hovering shows a fainter version of
  the same bar. Both are suppressed under reduced-motion.
- Entries are ordinary `#anchor` links, so they jump (smoothly, unless the reader
  has reduced-motion set).

Two things to leave alone unless you know why they're there: the `<style>` block
must stay *after* the template `<script>` (the framework injects its stylesheet
just before the first script tag, so earlier rules lose), and `d-article` is
overridden to `overflow-x: clip` — the template's `overflow-x: hidden` makes
`d-article` a scroll container, which silently breaks `position: sticky`.

## Component cheatsheet

- `<d-math>` inline, `<d-math block>` for display equations (KaTeX). `$$...$$` also works inline via the front-matter `katex.delimiters` config.
- `<d-cite key="a,b">` — comma-separated BibTeX keys.
- `<d-footnote>` — hover box inline, collected in the appendix.
- `<d-code language="python">` inline, add `block` for a code block.
- `<d-figure>` — fires `ready` / `onscreen` / `offscreen` events for lazily initializing visualizations.
- Grid columns: `style="grid-column: page"` (also `text`, `screen`, `middle`, `gutter`).

`_reference-article-test.html` exercises nearly every component if you need a working example.
