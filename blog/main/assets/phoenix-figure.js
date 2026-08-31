// Candidate isolation.
//
// Phoenix scores every candidate in one forward pass by laying them out as a
// single sequence -- [you | your history | candidate 1 .. candidate N] -- and
// masking attention so a candidate can see you and your history but never
// another candidate.
//
// The figure is the attention matrix itself: rows are what is doing the
// looking, columns are what can be looked at. The masked block is the whole
// design. Toggling it off is the point of the interaction: you can see
// immediately what the model gives up (candidates can never compare
// themselves to each other) in exchange for what it gets (one pass, and a
// score that does not depend on which other posts shared the batch).
//
// Hover any row to see what that position is allowed to attend to.

(function () {
  const HOST = document.getElementById('phoenix-figure');
  if (!HOST) return;

  const C = { user: '#1a7a9e', hist: '#2596be', cand: '#f97316',
              on: 'rgba(37,150,190,0.55)', off: 'rgba(17,17,17,0.05)',
              extra: 'rgba(249,115,22,0.30)' };

  const NU = 1, NH = 7, NC = 5;        // illustrative; production is 1 + 1024 + N
  const N  = NU + NH + NC;
  const kind = i => i < NU ? 'user' : (i < NU + NH ? 'hist' : 'cand');
  const label = i => i < NU ? 'you'
    : i < NU + NH ? `history ${i - NU + 1}` : `candidate ${i - NU - NH + 1}`;

  let masked = true;

  // Causal within you+history; candidates attend to you+history and themselves.
  // With the mask off, candidates may also attend to earlier candidates.
  function allowed(q, k) {
    if (kind(q) !== 'cand') return k <= q;            // ordinary causal prefix
    if (kind(k) !== 'cand') return true;              // you + all of history
    if (k === q) return true;                         // itself
    return !masked && k < q;                          // other candidates
  }

  HOST.innerHTML = `
    <p class="fig-title">One pass, N posts, and a hole in the attention matrix</p>
    <div class="fig-legend">
      <span><i style="background:${C.user}"></i>you</span>
      <span><i style="background:${C.hist}"></i>your history</span>
      <span><i style="background:${C.cand}"></i>candidate posts</span>
      <span><i style="background:${C.extra}"></i>allowed only with the mask off</span>
    </div>
    <div class="px-wrap">
      <div class="px-grid-scroll">
        <svg class="px-grid" role="img"
             aria-label="Attention mask over a sequence of you, your history, and candidate posts"></svg>
      </div>
      <div class="px-side">
        <button class="px-toggle" type="button"></button>
        <p class="px-read"></p>
      </div>
    </div>`;
  const svg = HOST.querySelector('.px-grid');
  const toggle = HOST.querySelector('.px-toggle');
  const read = HOST.querySelector('.px-read');
  const CELL = 22, PAD = 58;

  function draw(hoverRow) {
    const W = PAD + N * CELL + 8, H = PAD + N * CELL + 8;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%');

    let out = '';
    // column headers
    for (let k = 0; k < N; k++) {
      out += `<rect x="${PAD + k * CELL + 3}" y="${PAD - 12}" width="${CELL - 6}" height="6"
                    rx="1" fill="${C[kind(k)]}" opacity="0.7"/>`;
    }
    for (let q = 0; q < N; q++) {
      const y = PAD + q * CELL;
      out += `<rect x="${PAD - 12}" y="${y + 3}" width="6" height="${CELL - 6}"
                    rx="1" fill="${C[kind(q)]}" opacity="0.7"/>`;
      for (let k = 0; k < N; k++) {
        const ok = allowed(q, k);
        const extra = ok && !masked && kind(q) === 'cand' && kind(k) === 'cand' && k !== q;
        const dim = hoverRow != null && hoverRow !== q;
        out += `<rect class="px-cell" x="${PAD + k * CELL + 1.5}" y="${y + 1.5}"
                      width="${CELL - 3}" height="${CELL - 3}" rx="2"
                      fill="${ok ? (extra ? C.extra : C.on) : C.off}"
                      opacity="${dim ? 0.25 : 1}" data-q="${q}"/>`;
      }
    }
    // the isolation block, outlined so it reads as one region
    if (masked) {
      const x = PAD + (NU + NH) * CELL, s = NC * CELL;
      out += `<rect x="${x}" y="${PAD + (NU + NH) * CELL}" width="${s}" height="${s}"
                    fill="none" stroke="${C.cand}" stroke-width="1.2"
                    stroke-dasharray="3 3" opacity="0.75"/>`;
    }
    svg.innerHTML = out;
  }

  function setRead(q) {
    if (q == null) {
      read.innerHTML = masked
        ? `Each candidate sees <b>you</b> and <b>your history</b> — and nothing else. Five
           candidates, one pass, five independent scores.`
        : `Candidates can now see each other. The model could compare them — but a post's score
           would depend on its batch, and it could no longer be cached or compared across
           requests.`;
      return;
    }
    const ks = [];
    for (let k = 0; k < N; k++) if (allowed(q, k)) ks.push(label(k));
    read.innerHTML = `<b>${label(q)}</b> attends to ${ks.length} position${ks.length === 1 ? '' : 's'}: `
      + ks.join(', ') + '.';
  }

  svg.addEventListener('mousemove', e => {
    const c = e.target.closest('.px-cell');
    if (!c) return;
    const q = +c.dataset.q;
    draw(q); setRead(q);
  });
  svg.addEventListener('mouseleave', () => { draw(null); setRead(null); });

  toggle.addEventListener('click', () => {
    masked = !masked;
    toggle.textContent = masked ? 'turn the mask off' : 'put the mask back';
    draw(null); setRead(null);
  });

  toggle.textContent = 'turn the mask off';
  draw(null); setRead(null);
})();
