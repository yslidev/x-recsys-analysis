# Distill blog — local authoring
PORT ?= 8080

.PHONY: serve template render clean

# Serve this directory at http://localhost:$(PORT)
serve:
	python3 -m http.server $(PORT)

# Rebuild the Distill framework from ../template and copy the bundle in here.
# Run this after editing anything under ../template/src.
template:
	cd ../template && npm install --no-audit --no-fund && npm run build
	cp ../template/dist/template.v2.js ./template.v2.js

# Pre-render index.html to a static file (math, citations, TOC, byline baked in).
render:
	node ../template/bin/render.js -i index.html -o dist/index.html

clean:
	rm -f template.v2.js
	rm -rf dist
