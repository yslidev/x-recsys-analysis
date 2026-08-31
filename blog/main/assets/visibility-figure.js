// Two questions, two realities.
//
// v1 of this figure just switched between two end states. The mechanism is
// more interesting than the outcome, and it is legible in the source, so this
// version runs it.
//
// visibility-filtering/rules/mod.rs, evaluate_rules():
//   Drop         -> return immediately, decided_by = this rule
//   Interstitial -> record it if nothing recorded yet, and KEEP SCANNING
//   Allow        -> nothing
//
// registry.rs: timeline_home is 29 base rules. timeline_home_recommendations
// is those same 29 plus 26 drop-only rules appended.
//
// So the two readers' scans are *identical* for 29 rules. They diverge only
// because one list keeps going. A post that was flagged-and-allowed for your
// followers gets caught by rules that only exist on the other path. That is
// the finding, and watching the scan is the only way to see it.

(function () {
  const HOST = document.getElementById('visibility-figure');
  if (!HOST) return;

  const C = { allow: '#2596be', inter: '#c9a227', drop: '#f97316',
              hair: 'rgba(164,218,222,0.55)', dim: 'rgba(17,17,17,0.16)' };

  const BASE = 29;   // base_home_rules()
  const OON  = 26;   // the oon_drops block appended for recommendations

  // Each case: which base rule fires (index into the base list) and what it
  // returns, plus which appended rule catches it on the recommendation path.
  const CASES = [
    { id: 'none', chip: 'no label',
      base: null, oon: null,
      note: 'No rule matches. Both scans run to the end and return Allow.' },

    { id: 'nsfwp', chip: 'NSFW (high precision)',
      base: { i: 25, act: 'inter', name: 'NSFW_HIGH_PRECISION_INTERSTITIAL' },
      oon:  { i: 6,  name: 'NSFW_HIGH_PRECISION_DROP' },
      note: 'Both scans hit the same interstitial rule at position 26 — and neither stops, '
          + 'because an Interstitial does not short-circuit. The follower’s scan then runs '
          + 'out of rules. The stranger’s runs into twenty-six more.' },

    { id: 'gore', chip: 'gore & violence',
      base: { i: 26, act: 'inter', name: 'GORE_AND_VIOLENCE_INTERSTITIAL' },
      oon:  { i: 8,  name: 'GORE_AND_VIOLENCE_HIGH_PRECISION_DROP' },
      note: 'The same shape again: warn the people who chose to follow you, withhold from '
          + 'everyone else.' },

    { id: 'author', chip: 'author marked NSFW',
      base: { i: 28, act: 'inter', name: 'NsfwAuthorInterstitialRule' },
      oon:  { i: 2,  name: 'NSFW_USER_AUTHOR_DROP' },
      note: 'This label is on the account, not the post — so every post inherits it, including '
          + 'ones already published.' },

    { id: 'recall', chip: 'NSFW (high recall)',
      base: null,
      oon:  { i: 6, name: 'NSFW_HIGH_RECALL_DROP' },
      note: 'The quiet one. No base rule matches at all, so the follower’s scan returns a '
          + 'clean Allow — nothing looks wrong from where you are standing — while the post '
          + 'has stopped reaching anyone new.' },

    { id: 'dna', chip: 'do not amplify',
      base: null,
      oon:  { i: 10, name: 'DO_NOT_AMPLIFY_DROP' },
      note: 'No warning, no gap, no signal of any kind. The post simply stops travelling.' },

    { id: 'spam', chip: 'spam',
      base: { i: 10, act: 'drop', name: 'SPAM_DROP' },
      oon:  null,
      note: 'Not everything is asymmetric. Spam is in the shared base set, so it returns Drop '
          + 'on rule 11 for both readers and neither scan gets any further.' },
  ];

  const WORD = { allow: 'allow', inter: 'interstitial', drop: 'drop' };
  const COL  = { allow: C.allow, inter: C.inter, drop: C.drop };

  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  HOST.innerHTML = `
    <p class="fig-title">The same rules, and then twenty-six more</p>
    <div class="fig-legend">
      <span><i style="background:${C.allow}"></i>allow</span>
      <span><i style="background:${C.inter}"></i>interstitial, shown behind a tap</span>
      <span><i style="background:${C.drop}"></i>drop, not there at all</span>
      <span><i style="background:${C.dim}"></i>rule ran, did not match</span>
    </div>
    <div class="vf">
      <div class="vf-chips" role="group" aria-label="safety label">
        ${CASES.map(c => `<button type="button" class="vf-chip" data-id="${c.id}"
          aria-pressed="${c.id === 'none'}">${c.chip}</button>`).join('')}
      </div>
      <div class="vf-cols">
        ${col('inn', 'A follower', 'timeline_home', BASE)}
        ${col('oon', 'Not a follower', 'timeline_home_recommendations', BASE + OON)}
      </div>
      <p class="vf-note" aria-live="polite"></p>
    </div>`;
  function col(side, who, level, n) {
    const ticks = Array.from({ length: n }, (_, i) =>
      `<i class="vf-tick${i >= BASE ? ' vf-tick-oon' : ''}" data-i="${i}"></i>`).join('');
    return `
      <div class="vf-col" data-side="${side}">
        <div class="vf-col-head">
          <span class="vf-who">${who}</span>
          <span class="vf-level">${level} · ${n} rules</span>
        </div>
        <div class="vf-scan">${ticks}</div>
        <div class="vf-post">
          <div class="vf-lines"><i style="width:88%"></i><i style="width:96%"></i><i style="width:54%"></i></div>
          <div class="vf-veil"><span>Sensitive content — tap to view</span></div>
        </div>
        <div class="vf-verdict"><span class="vf-word"></span><code class="vf-rule"></code></div>
      </div>`;
  }

  const chips = HOST.querySelector('.vf-chips');

  function run(id) {
    clear();
    const c = CASES.find(x => x.id === id);
    chips.querySelectorAll('.vf-chip').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    HOST.querySelector('.vf-note').textContent = c.note;

    ['inn', 'oon'].forEach(side => {
      const el = HOST.querySelector(`.vf-col[data-side="${side}"]`);
      const ticks = [...el.querySelectorAll('.vf-tick')];
      const total = ticks.length;
      ticks.forEach(t => { t.className = 'vf-tick' + (+t.dataset.i >= BASE ? ' vf-tick-oon' : ''); });
      el.dataset.verdict = '';
      el.querySelector('.vf-word').textContent = '';
      el.querySelector('.vf-rule').textContent = '';

      // where this scan stops, and what it returns
      let stopAt = total - 1, verdict = 'allow', rule = '';
      const hit = [];
      if (c.base) {
        hit.push({ i: c.base.i, kind: c.base.act, name: c.base.name });
        if (c.base.act === 'drop') { stopAt = c.base.i; verdict = 'drop'; rule = c.base.name; }
        else { verdict = 'inter'; rule = c.base.name; }
      }
      if (side === 'oon' && c.oon && verdict !== 'drop') {
        const oi = BASE + c.oon.i;
        hit.push({ i: oi, kind: 'drop', name: c.oon.name });
        stopAt = oi; verdict = 'drop'; rule = c.oon.name;
      }

      const step = reduced ? 0 : Math.max(9, 420 / total);
      for (let i = 0; i <= stopAt; i++) {
        const m = hit.find(h => h.i === i);
        const paint = () => {
          const t = ticks[i];
          if (!t) return;
          t.classList.add(m ? `vf-hit-${m.kind}` : 'vf-ran');
        };
        timers.push(setTimeout(paint, reduced ? 0 : i * step));
      }
      timers.push(setTimeout(() => {
        el.dataset.verdict = verdict;
        const w = el.querySelector('.vf-word');
        w.textContent = WORD[verdict];
        w.style.color = COL[verdict];
        el.querySelector('.vf-rule').textContent = rule;
      }, reduced ? 0 : (stopAt + 1) * step + 60));
    });
  }

  chips.addEventListener('click', e => {
    const b = e.target.closest('.vf-chip');
    if (b) run(b.dataset.id);
  });
  run('none');
})();
