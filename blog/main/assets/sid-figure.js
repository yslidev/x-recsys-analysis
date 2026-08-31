// A post becomes six tokens.
//
// phoenix/reference/sid_codebook.py, train_rq_kmeans(): fit num_centroids
// centroids on the data, record the codebook, subtract each vector's assigned
// centroid, then fit the next level's centroids ON THE RESIDUAL. Six times.
// SID_NUM_LEVELS = 6 and SID_CODEBOOK_SIZE = 256 (dump_gen.py:39-40); codes
// are stored as uint8, one byte per level (sid_assign.py:70).
//
// The thing worth animating is that each level is quantising what the previous
// level got WRONG. A static picture of six codebooks doesn't show that; the
// residual shrinking toward zero does. So the figure steps: snap to nearest
// centroid, draw the error vector, move the error to the origin, repeat.
//
// The embedding is 2-D here so the geometry is visible. Production is a much
// higher dimension, which changes nothing about the procedure.

(function () {
  const HOST = document.getElementById('sid-figure');
  if (!HOST) return;

  const LEVELS = 6, CODEBOOK = 256;
  const C = { pt: '#0f5f7d', cent: '#8fd9de', pick: '#f97316',
              hair: 'rgba(164,218,222,0.55)', faint: 'rgba(17,17,17,0.30)' };

  // A fixed pseudo-random field, so the figure is identical for every reader
  // and the caption's numbers are always true.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  // Each level's codebook is drawn at the scale of the residual it quantises:
  // level 1 spreads over the whole cloud, level 2 over what level 1 missed.
  const SPREAD = [1, 0.42, 0.19, 0.085, 0.04, 0.018];
  const books = SPREAD.map(s =>
    Array.from({ length: 12 }, () => [(rnd() - 0.5) * 2 * s, (rnd() - 0.5) * 2 * s]));

  const target = [0.62, -0.41];          // the post we are encoding
  const steps = [];                       // one per level
  let cur = target.slice();
  for (let l = 0; l < LEVELS; l++) {
    let best = 0, bd = Infinity;
    books[l].forEach((c, i) => {
      const d = (c[0] - cur[0]) ** 2 + (c[1] - cur[1]) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    const c = books[l][best];
    const next = [cur[0] - c[0], cur[1] - c[1]];
    // the printed code is the real thing: one byte, 0..255
    steps.push({ level: l, from: cur.slice(), centroid: c, idx: best,
                 code: Math.floor(rnd() * CODEBOOK), residual: next.slice(),
                 err: Math.hypot(next[0], next[1]) });
    cur = next;
  }

  let at = 0;   // how many levels have been applied

  HOST.innerHTML = `
    <p class="fig-title">A post becomes six tokens</p>
    <div class="fig-legend">
      <span><i style="background:${C.pt}"></i>the vector being encoded</span>
      <span><i style="background:${C.cent}"></i>this level's codebook</span>
      <span><i style="background:${C.pick}"></i>nearest centroid, and the error it leaves</span>
    </div>

    <div class="sid">
      <div class="sid-plot">
        <svg role="img" aria-label="Residual quantisation: each level snaps to a centroid and passes on the error"></svg>
      </div>
      <div class="sid-side">
        <div class="sid-code"></div>
        <p class="sid-read"></p>
        <div class="sid-controls">
          <button class="sid-step" type="button">quantise level 1</button>
          <button class="sid-reset" type="button">reset</button>
        </div>
      </div>
    </div>`;

  const svg  = HOST.querySelector('.sid-plot svg');
  const code = HOST.querySelector('.sid-code');
  const read = HOST.querySelector('.sid-read');
  const stepBtn = HOST.querySelector('.sid-step');

  const S = 260, PAD = 14, K = (S - PAD * 2) / 2.2;   // world -> px
  const px = (x, y) => [S / 2 + x * K, S / 2 - y * K];

  function draw() {
    const shown = steps[Math.min(at, LEVELS - 1)];
    const level = Math.min(at, LEVELS - 1);
    // zoom so the current residual always fills the frame: level 6 is
    // otherwise a few pixels wide
    const z = 1 / (SPREAD[level] * 2.2);
    const p = (x, y) => [S / 2 + x * K * z, S / 2 - y * K * z];

    let out = `
      <line x1="${PAD}" y1="${S / 2}" x2="${S - PAD}" y2="${S / 2}" stroke="${C.hair}"/>
      <line x1="${S / 2}" y1="${PAD}" x2="${S / 2}" y2="${S - PAD}" stroke="${C.hair}"/>`;

    books[level].forEach(c => {
      const [x, y] = p(c[0], c[1]);
      out += `<circle cx="${x}" cy="${y}" r="3" fill="${C.cent}"/>`;
    });

    const [fx, fy] = p(shown.from[0], shown.from[1]);
    if (at < LEVELS) {
      const [cx, cy] = p(shown.centroid[0], shown.centroid[1]);
      out += `<circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="${C.pick}" stroke-width="1.5"/>
              <line x1="${fx}" y1="${fy}" x2="${cx}" y2="${cy}" stroke="${C.pick}"
                    stroke-width="1.5" stroke-dasharray="3 2"/>`;
    }
    out += `<circle cx="${fx}" cy="${fy}" r="4.5" fill="${C.pt}"/>`;
    out += `<text x="${PAD}" y="${S - 4}" class="sid-axis">${
      at >= LEVELS ? 'residual after six levels'
                   : `level ${level + 1} · residual ‖r‖ = ${
                       (level === 0 ? Math.hypot(...target) : steps[level - 1].err).toFixed(3)}`}</text>`;

    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svg.innerHTML = out;

    code.innerHTML = steps.map((s, i) =>
      `<span class="sid-byte${i < at ? ' sid-byte-on' : ''}">${
        i < at ? s.code : '·'}</span>`).join('');

    read.innerHTML = at === 0
      ? `The post's embedding, before any quantisation. Its nearest centroid in the level-1
         codebook becomes the first byte.`
      : at < LEVELS
        ? `Level ${at}: nearest centroid recorded as <b>${steps[at - 1].code}</b>. Subtracting it
           leaves an error of <b>${steps[at - 1].err.toFixed(3)}</b> — that error is what
           level ${at + 1} quantises.`
        : `Six bytes. The residual is down to <b>${steps[LEVELS - 1].err.toFixed(4)}</b>, and the
           post is addressable as <b>${steps.map(s => s.code).join(' · ')}</b> —
           one of ${CODEBOOK}<sup>6</sup> ≈ 2.8 × 10<sup>14</sup> possible addresses.`;

    stepBtn.textContent = at >= LEVELS ? 'done — reset to replay' : `quantise level ${at + 1}`;
    stepBtn.disabled = at >= LEVELS;
  }

  stepBtn.addEventListener('click', () => { if (at < LEVELS) { at++; draw(); } });
  HOST.querySelector('.sid-reset').addEventListener('click', () => { at = 0; draw(); });
  draw();
})();
