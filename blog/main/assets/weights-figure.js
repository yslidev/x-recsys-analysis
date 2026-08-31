// How one post gets its score.
//
// v1 of this figure was 26 bars on one linear axis. At a scale that fits
// Report at -234, twenty of the twenty-six bars are sub-pixel slivers -- so it
// failed as a chart (you cannot read the values) while only half-working as an
// argument. This version splits the job in two, which is the "reduce cognitive
// load" lesson from Communicating with Interactive Articles in inspo/:
//
//   Panel A -- the weights. All 26 as readable chips; colour carries the sign,
//     opacity carries magnitude. This is the reference table, legibly.
//   Panel B -- the arithmetic. A waterfall: each contribution is probability
//     times weight, laid end to end from zero. Where the bar stops is the
//     score. Drag a probability and the waterfall re-flows.
//
// The waterfall follows the Thinking Machines atomic-add figure in inspo/:
// don't draw the result, draw the accumulation that produces it.
//
// Numbers come from window.loadWeights() -- live param.rs where reachable.

(function () {
  const HOST = document.getElementById('weights-figure');
  if (!HOST) return;

  const C = { pos: '#2596be', neg: '#f97316',
              hair: 'rgba(164,218,222,0.55)', mute: 'rgba(17,17,17,0.45)' };

  // The six a reader has intuitions about, in the order they'd think of them.
  const DIALS = [
    { key: 'FavoriteWeight',         label: 'like it',            p: 0.120, max: 0.40 },
    { key: 'ReplyWeight',            label: 'reply',              p: 0.010, max: 0.10 },
    { key: 'ShareViaCopyLinkWeight', label: 'copy the link',      p: 0.004, max: 0.05 },
    { key: 'DwellWeight',            label: 'dwell on it',        p: 0.300, max: 1.00 },
    { key: 'NotInterestedWeight',    label: 'hit not-interested', p: 0.000, max: 0.02 },
    { key: 'ReportWeight',           label: 'report it',          p: 0.000, max: 0.01 },
  ];

  const fmt = w => (w < 0 ? '−' : '') +
    (Number.isInteger(w) ? Math.abs(w).toFixed(1) : String(Math.abs(w)));
  const pct = p => p >= 0.01 ? (p * 100).toFixed(1) + '%' : (p * 100).toFixed(2) + '%';

  window.loadWeights().then(build).catch(() => {
    HOST.innerHTML = '<figcaption>Weights figure unavailable — no source could be read.</figcaption>';
  });

  function build(data) {
    const byKey = Object.fromEntries(data.weights.map(r => [r.param, r]));
    const dials = DIALS.filter(d => byKey[d.key]);
    const maxAbs = Math.max(...data.weights.map(r => Math.abs(r.weight)));

    HOST.innerHTML = `
      <p class="fig-title">How one post gets its score</p>
      <div class="fig-legend">
        <span><i style="background:${C.pos}"></i>reward</span>
        <span><i style="background:${C.neg}"></i>penalty</span>
        <span><i style="background:transparent;border:1px dashed ${C.mute}"></i>last known value</span>
      </div>

      <div class="wf-panel">
        <div class="wf-panel-head">the 26 weights &middot; ${window.weightsProvenance(data)}</div>
        <div class="wf-chips"></div>
      </div>

      <div class="wf-panel">
        <div class="wf-panel-head">score = Σ <i>w</i> × P(action) &middot; drag a probability</div>
        <div class="wf-dials"></div>
        <svg class="wf-fall" role="img"
             aria-label="Waterfall showing each action's contribution accumulating into a score"></svg>
        <div class="wf-score">
          <span class="wf-score-lab">this post scores</span>
          <span class="wf-score-val"></span>
          <span class="wf-score-note"></span>
        </div>
      </div>`;
    // ---- Panel A: the weights, readable ---------------------------------
    HOST.querySelector('.wf-chips').innerHTML = data.weights.map(r => {
      const neg = r.weight < 0;
      const strength = Math.min(1, Math.abs(r.weight) / maxAbs * 3 + 0.18);
      return `<span class="wf-chip${r.live === false ? ' wf-chip-stale' : ''}"
                    style="--c:${neg ? C.neg : C.pos};--a:${strength.toFixed(2)}"
                    title="${r.param}"><b>${r.label}</b><em>${fmt(r.weight)}</em></span>`;
    }).join('');

    // ---- Panel B: the arithmetic ----------------------------------------
    HOST.querySelector('.wf-dials').innerHTML = dials.map((d, i) => `
      <label class="wf-dial">
        <span class="wf-dial-name">you ${d.label}</span>
        <input type="range" min="0" max="1000" value="${Math.round(d.p / d.max * 1000)}"
               data-i="${i}" aria-label="probability that you ${d.label}">
        <span class="wf-dial-p"></span>
        <span class="wf-dial-w">× ${fmt(byKey[d.key].weight)}</span>
      </label>`).join('');

    const svg      = HOST.querySelector('.wf-fall');
    const inputs   = [...HOST.querySelectorAll('.wf-dial input')];
    const dialEls  = [...HOST.querySelectorAll('.wf-dial')];
    const scoreVal = HOST.querySelector('.wf-score-val');
    const scoreNote= HOST.querySelector('.wf-score-note');
    const H = 74, PAD = 16;

    function recompute() {
      let running = 0;
      const steps = dials.map((d, i) => {
        const p = +inputs[i].value / 1000 * d.max;
        d.p = p;
        const c = p * byKey[d.key].weight;
        const from = running;
        running += c;
        dialEls[i].querySelector('.wf-dial-p').textContent = pct(p);
        return { label: d.label, c, from, to: running };
      }).filter(s => Math.abs(s.c) > 1e-9);

      const total = running;
      const lo = Math.min(0, ...steps.map(s => Math.min(s.from, s.to)));
      const hi = Math.max(0, ...steps.map(s => Math.max(s.from, s.to)));
      const span = (hi - lo) || 1;
      const W  = Math.max(280, HOST.getBoundingClientRect().width || 640);
      const sx = v => PAD + (v - lo) / span * (W - PAD * 2);

      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('height', H);

      // Adjacent same-signed segments would merge into one undifferentiated
      // bar, hiding the accumulation that is the whole point. A 1px white
      // gutter between them keeps each contribution countable -- the same
      // trick the atomic-add figure in inspo/ uses between its layers.
      const GAP = 1;
      const bars = steps.map(s => {
        const x0 = Math.min(sx(s.from), sx(s.to));
        const raw = Math.abs(sx(s.to) - sx(s.from));
        const w = Math.max(raw - GAP, 1);
        const col = s.c < 0 ? C.neg : C.pos;
        return `<rect x="${x0 + (s.c < 0 ? GAP : 0)}" y="16" width="${w}" height="20"
                      rx="1.5" fill="${col}" opacity="0.85"
                ><title>you ${s.label}: ${
                  s.c >= 0 ? '+' : '−'}${Math.abs(s.c).toFixed(3)}  (P ${pct(Math.abs(s.c / byKey[dials.find(d => d.label === s.label).key].weight))})</title></rect>`;
      }).join('');

      svg.innerHTML = `
        <line x1="${sx(0)}" y1="9" x2="${sx(0)}" y2="49" stroke="${C.hair}"/>
        <text x="${sx(0)}" y="61" class="wf-tick" text-anchor="middle">0</text>
        ${bars}
        <line x1="${sx(total)}" y1="11" x2="${sx(total)}" y2="47"
              stroke="${total < 0 ? C.neg : C.pos}" stroke-width="2"/>
        <text x="${sx(total)}" y="${H - 5}" text-anchor="middle" class="wf-tick"
              fill="${total < 0 ? C.neg : C.pos}">score</text>`;

      scoreVal.textContent = (total < 0 ? '−' : '+') + Math.abs(total).toFixed(3);
      scoreVal.style.color = total < 0 ? C.neg : C.pos;

      const rep = dials.find(d => d.key === 'ReportWeight');
      scoreNote.textContent = total < 0
        ? '— negative, so it sorts below a post nobody feels anything about.'
          + (rep && rep.p > 0 ? ` A ${pct(rep.p)} chance of a report did that.` : '')
        : (rep && rep.p > 0 ? '— still positive. Keep going.'
                            : '— now give it a small chance of being reported.');
    }

    inputs.forEach(i => i.addEventListener('input', recompute));
    if (window.ResizeObserver) new ResizeObserver(recompute).observe(HOST);
    recompute();
  }
})();
