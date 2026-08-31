# Distill blog — local authoring
PORT ?= 8080

.PHONY: serve template render weights test clean

# Serve this directory at http://localhost:$(PORT)
serve:
	python3 -m http.server $(PORT)

# Rebuild the Distill framework from ../template and copy the bundle in here.
# Run this after editing anything under ../template/src.
template:
	cd ../template && npm install --no-audit --no-fund && npm run build
	cp ../template/dist/template.v2.js ./template.v2.js

# Regenerate assets/weights.json from the algorithm checkout's param.rs.
weights:
	python3 tools/gen_weights.py

# Failure tests for the live weights pipeline (parser + fallback chain).
test:
	node --test tools/test_weights.mjs

# Pre-render index.html to a static file (math, citations, TOC, byline baked in).
render: template.v2.js
	@mkdir -p dist
	node ../template/bin/render.js -i index.html -o dist/index.html
	@cp template.v2.js dist/
	@cp -R assets dist/
	@echo "dist/ ready: $$(du -sh dist | cut -f1), deployable as-is"

clean:
	rm -f template.v2.js
	rm -rf dist
