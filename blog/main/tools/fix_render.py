#!/usr/bin/env python3
"""Post-render corrections to dist/index.html.

`make render` runs transforms.render() and then transforms.distillify(), and
distillify layers distill.pub's own site metadata over ours. Two things it
gets wrong for a self-published article, neither fixable from front matter:

  1. The citation claims the piece was published in *Distill*. It wasn't.
  2. serializeFrontmatterToBibtex() emits `journal`, `note` and `doi` from
     fields distillify has already overwritten, so they render as the literal
     string "undefined".

Also strips distillify's absolute <link href="/rss.xml">, which resolves
against the host's root and 404s anywhere that isn't distill.pub.

Run by `make render`; safe to run twice.
"""
import re
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist/index.html"
JOURNAL = "ysli.dev"
URL = "https://ysli.dev/writing/x-recsys/"

if not DIST.exists():
    sys.exit(f"{DIST} not found — run `make render` first")

html = DIST.read_text()
before = html
changed = []

# 1. the human-readable citation line
n = len(re.findall(r'",\s*Distill,\s*(\d{4})', html))
if n:
    html = re.sub(r'",\s*Distill,\s*(\d{4})', rf'", {JOURNAL}, \1', html)
    changed.append(f"citation venue Distill -> {JOURNAL} ({n})")

# 2. the bibtex fields distillify left undefined
if "journal = {undefined}" in html:
    html = html.replace("journal = {undefined}", f"journal = {{{JOURNAL}}}")
    changed.append("bibtex journal")
if "note = {undefined}" in html:
    html = html.replace("note = {undefined}", f"note = {{{URL}}}")
    changed.append("bibtex note")
# no DOI is registered for this article, so the field should not be there
html = re.sub(r",?\n\s*doi = \{undefined\}", "", html)
if "doi = {undefined}" not in html and "doi = {undefined}" in before:
    changed.append("bibtex doi removed")

# 3. distillify's absolute feed link, which 404s off distill.pub
n = len(re.findall(r'<link[^>]*href="/rss\.xml"[^>]*>', html))
if n:
    html = re.sub(r'\s*<link[^>]*href="/rss\.xml"[^>]*>', "", html)
    changed.append(f"absolute /rss.xml link ({n})")

DIST.write_text(html)
print("fix_render:", ", ".join(changed) if changed else "nothing to correct")
