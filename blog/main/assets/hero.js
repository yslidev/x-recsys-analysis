/* Hero: one For You request through the pipeline.
 *
 * A canvas animation of the candidate funnel, narrated by a numbered phase
 * caption: a request pulse sweeps from the feed back to the viewer-context
 * lookups, candidate dots (hollow = bare IDs, filled = hydrated posts) stream
 * through the gates (hydrate -> filter -> score -> diversify -> visibility),
 * survivors dock into the feed with an ad and a who-to-follow module blended
 * in, and the served feed is finally logged back as training data.
 *
 * Counts shown are the real ones from the codebase (home-mixer/params/config.rs:
 * TOP_K_CANDIDATES_TO_SELECT = 50, RESULT_SIZE = 35, MAX_POST_AGE = 48 h); the
 * number of dots is illustrative.
 *
 * The scene is drawn in a fixed logical coordinate system (W x H) and scaled
 * to the canvas, so every position below is in logical units.
 */
(function () {
  'use strict';

  var figure = document.getElementById('hero-pipeline');
  if (!figure) return;
  var canvas = figure.querySelector('canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return; // e.g. jsdom during `make render`

  var W = 1160, H = 590;
  var CYCLE = 18000;          // ms per loop
  var FADE_OUT = 17000;       // dynamic content starts fading here
  var STATIC_T = 9800;        // frame shown under prefers-reduced-motion

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---- palette ---------------------------------------------------------- */

  var C = {
    // ysli.dev palette. Teal family = sources you already have a relationship
    // with; the site's orange accent is reserved for the model path, which is
    // the thing the article is actually about.
    ink:     '#111111',                  // --foreground
    muted:   'rgba(17,17,17,0.55)',
    faint:   'rgba(17,17,17,0.30)',
    hair:    'rgba(164,218,222,0.55)',   // the .superlink hairline
    // Three steps down the teal ramp, spaced far enough apart to stay
    // separable at dot size; the accent orange carries the model path.
    thunder: '#0f5f7d',   // in-network: teal-dark, deepened
    phoenix: '#f97316',   // model retrieval: --accent
    simclus: '#8fd9de',   // communities: --teal, lightened
    mixer:   '#2596be',   // tweet-mixer: --teal-deep
    ad:      '#c9a227',
    paper:   '#ffffff'
  };

  var MONO = '"Berkeley Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  /* ---- layout ----------------------------------------------------------- */

  var BAND = { top: 160, bottom: 425, mid: 292 };

  var SOURCES = [
    { key: 'thunder', name: 'Thunder',     sub: 'people you follow',  color: C.thunder, y: 175, n: 58 },
    { key: 'phoenix', name: 'Phoenix',     sub: 'model retrieval',    color: C.phoenix, y: 255, n: 44 },
    { key: 'simclus', name: 'SimClusters', sub: 'communities',        color: C.simclus, y: 335, n: 32 },
    { key: 'mixer',   name: 'TweetMixer',  sub: 'graph expansion',    color: C.mixer,   y: 415, n: 24 }
  ];
  var EMIT_X = 208, MERGE_X = 350;

  var GATES = [
    { key: 'hydrate',   x: 398, name: 'Hydrate',    sub: '12 hydrators' },
    { key: 'filter',    x: 512, name: 'Filter',     sub: '18 checks' },
    { key: 'score',     x: 626, name: 'Score',      sub: 'phoenix + 26 weights' },
    { key: 'diversify', x: 740, name: 'Diversify',  sub: 'map-dpp · top 50' },
    { key: 'visibility',x: 852, name: 'Visibility', sub: 'per-viewer rules' }
  ];
  var GATE = {};
  GATES.forEach(function (g) { GATE[g.key] = g.x; });

  var FEED = { x: 950, y: 76, w: 172, h: 448, rowH: 30, rowGap: 3, headH: 40, pad: 11 };
  var SLOT_COUNT = 12;
  var AD_SLOT = 3, WTF_SLOT = 6;           // 0-indexed rows for the blended items
  var POST_SLOTS = [];
  for (var s = 0; s < SLOT_COUNT; s++) if (s !== AD_SLOT && s !== WTF_SLOT) POST_SLOTS.push(s);

  var STORES = { x: 852, y: 64 };          // label stores icon, feeding VISIBILITY

  function slotRect(i) {
    return {
      x: FEED.x + FEED.pad,
      y: FEED.y + FEED.headH + i * (FEED.rowH + FEED.rowGap),
      w: FEED.w - FEED.pad * 2,
      h: FEED.rowH
    };
  }

  /* ---- the narration: numbered phases ----------------------------------- */

  /* Phase start times (`t`) are recomputed every cycle in buildCycle() from
     the dots' actual spawn times and speeds, so the narration stays in sync
     with where the swarm really is. `gate` names the gate a phase lights up. */
  var PHASES = [
    { t: 0,     n: '01', name: 'A request arrives',
      sub: 'before any post is fetched, 17 parallel lookups build a picture of you' },
    { t: 3000,  n: '02', name: 'Candidate sourcing',
      sub: 'four recall paths return 3,000–4,000 post ids, just ids, nothing more' },
    { t: 4900,  n: '03', name: 'Hydration', gate: 'hydrate',
      sub: '12 parallel lookups fill each id in: text, author, media, counts' },
    { t: 6000,  n: '04', name: 'Filtering', gate: 'filter',
      sub: '18 sequential checks, seen it, blocked, muted, too old, thin the pool' },
    { t: 6800,  n: '05', name: 'Scoring', gate: 'score',
      sub: 'phoenix predicts your reactions; 26 fixed weights fold them into one score' },
    { t: 7700,  n: '06', name: 'Diversity & cut', gate: 'diversify',
      sub: 'a map-dpp pass trades score for variety; only the top 50 survive' },
    { t: 8600,  n: '07', name: 'Visibility & blending', gate: 'visibility',
      sub: 'per-viewer safety rules run last; ads and modules slot into fixed positions' },
    { t: 11200, n: '08', name: '35 posts served',
      sub: 'the feed ships, and a sample is logged to train tomorrow’s model' }
  ];

  // Times for the count labels; recomputed with the phases.
  var TL = { pool: 4400, top50: 8300, served: 11200 };

  function currentPhaseIndex(t) {
    var idx = 0;
    for (var i = 0; i < PHASES.length; i++) if (t >= PHASES[i].t) idx = i;
    return idx;
  }

  var CONTEXT_TICKS = [
    'Who you follow',
    'Blocks & mutes',
    'What you’ve seen',
    'Your last 1,024 actions'
  ];

  /* ---- annotations (hover) ---------------------------------------------- */

  var NOTES = [
    { rect: [28, 84, 200, 74], title: 'Viewer context',
      body: 'Query hydrators fetch who you follow, block and mute, what you have been shown, and your recent action sequence, the model’s picture of you.',
      path: 'home-mixer/query_hydrators/' },
    { rect: [28, 148, 190, 60], title: 'Thunder · in-network',
      body: 'Every post from people you follow, from the last 48 hours, held in RAM in reverse-chronological order. No ML at this stage.',
      path: 'thunder/' },
    { rect: [28, 228, 190, 60], title: 'Phoenix retrieval',
      body: 'A learned retrieval model picks out-of-network posts it predicts you will engage with, addressing posts by semantic IDs.',
      path: 'phoenix/ · phoenix-rankall/' },
    { rect: [28, 308, 190, 60], title: 'SimClusters',
      body: 'Posts surfacing from ~145k communities detected by factorizing the follow graph, a 2020-era method still in the mix.',
      path: 'simclusters/' },
    { rect: [28, 388, 190, 60], title: 'TweetMixer',
      body: 'An additional recall service contributing graph-based candidate paths.',
      path: 'home-mixer/sources/tweet_mixer_source.rs' },
    { rect: [222, 150, 152, 275], title: '3,000–4,000 candidates',
      body: 'The sources return only post IDs, hollow dots here. Everything after this narrows the pool down.',
      path: 'home-mixer/sources/' },
    { rect: [374, 130, 81, 320], title: 'Candidate hydration',
      body: '12 parallel lookups fill each ID in: text, media, author, language, engagement counts. Hollow ids become solid posts.',
      path: 'home-mixer/candidate_hydrators/' },
    { rect: [455, 130, 114, 320], title: '18 sequential filters',
      body: 'Older than 48 h, already seen, your own posts, blocked or muted authors, muted keywords, NSFW rules, most of the pool dies here.',
      path: 'home-mixer/filters/' },
    { rect: [569, 130, 114, 320], title: 'Phoenix scoring',
      body: 'One transformer pass predicts P(like), P(reply), P(report)… per post; 26 fixed weights fold them into a single score.',
      path: 'home-mixer/scorers/ · phoenix/' },
    { rect: [683, 130, 113, 320], title: 'Diversity re-rank',
      body: 'A MAP-DPP pass trades raw score for dissimilarity, then only the top 50 survive (TOP_K_CANDIDATES_TO_SELECT).',
      path: 'vm-ranker/dpp.rs' },
    { rect: [796, 130, 92, 320], title: 'Visibility filtering',
      body: 'Per-viewer safety rules decide allow, interstitial, or drop, the only stage that can make a post vanish for you.',
      path: 'visibility-filtering/' },
    { rect: [800, 32, 110, 76], title: 'The other half',
      body: 'Safety labels are written continuously by a separate offline pipeline. The two halves never call each other, they only meet in these stores.',
      path: 'grox/ · agatha/ · botmaker/ · scarecrow/' },
    { rect: [640, 495, 290, 70], title: 'The training loop',
      body: 'A sample of every served top-50 is logged with the exact weights used. Today’s feed is tomorrow’s training data.',
      path: 'home-mixer/side_effects/ · phoenix/xrex/' },
    { rect: [FEED.x, FEED.y, FEED.w, FEED.h], title: 'Your For You feed',
      body: '35 posts (RESULT_SIZE), blended with ads and a who-to-follow module at fixed positions, marshalled and sent back, in well under a second.',
      path: 'home-mixer/params/config.rs · selectors/' }
  ];

  /* ---- deterministic rng ------------------------------------------------ */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---- one cycle's worth of dots ---------------------------------------- */

  var dots = [], blends = [], cycleIndex = 0;

  function buildCycle(seed) {
    var rand = mulberry32(seed);
    dots = [];

    SOURCES.forEach(function (src, lane) {
      for (var i = 0; i < src.n; i++) {
        dots.push({
          lane: lane,
          color: src.color,
          t0: 3000 + lane * 150 + rand() * 2700,
          v: 0.150 * (0.88 + rand() * 0.27),
          laneY: src.y + (rand() - 0.5) * 34,
          bodyY: BAND.top + 14 + rand() * (BAND.bottom - BAND.top - 28),
          phase: rand() * Math.PI * 2,
          score: rand(),
          fate: 'filtered',
          x: 0, y: 0, r: 2.2, alpha: 0, vy: 0, fill: 0,
          state: 'waiting'
        });
      }
    });

    // Fates: ~42% of the pool survives the filters; of those, 12 pass the
    // top-50 gate; 2 die at visibility; 10 dock into the feed.
    var survivors = dots.slice().sort(function () { return rand() - 0.5; })
                        .slice(0, Math.round(dots.length * 0.42));
    survivors.forEach(function (d) { d.fate = 'cut50'; });

    var ranked = survivors.slice().sort(function (a, b) { return b.score - a.score; });
    ranked.forEach(function (d, i) {
      d.sortY = BAND.top + 8 + (i / (ranked.length - 1)) * (BAND.bottom - BAND.top - 16);
    });

    var finalists = ranked.slice(0, 12);
    // Two of the finalists (not the very top ones) are dropped by visibility.
    finalists[7].fate = 'visdrop';
    finalists[10].fate = 'visdrop';
    var served = finalists.filter(function (d) { return d.fate !== 'visdrop'; });
    served.forEach(function (d, i) {
      d.fate = 'served';
      d.rank = i;
      d.slot = POST_SLOTS[i];
      // Nudge speeds so higher-ranked posts tend to arrive first.
      d.v = 0.168 + (served.length - i) * 0.0042 + rand() * 0.004;
    });

    // Sync the narration to the swarm: a phase begins once a set fraction of
    // the relevant dots has actually crossed its gate.
    function crossAt(list, x, frac) {
      var ts = list.map(function (d) { return d.t0 + (x - EMIT_X) / d.v; })
                   .sort(function (a, b) { return a - b; });
      return ts[Math.min(ts.length - 1, Math.floor(ts.length * frac))];
    }
    var surv = dots.filter(function (d) { return d.fate !== 'filtered'; });
    var fin = dots.filter(function (d) { return d.fate === 'served' || d.fate === 'visdrop'; });
    var srv = dots.filter(function (d) { return d.fate === 'served'; });

    PHASES[1].t = 3000;
    PHASES[2].t = crossAt(dots, GATE.hydrate, 0.25);
    PHASES[3].t = crossAt(dots, GATE.filter, 0.30);
    PHASES[4].t = crossAt(surv, GATE.score, 0.35);
    PHASES[5].t = crossAt(surv, GATE.diversify, 0.40);
    PHASES[6].t = crossAt(fin, GATE.visibility, 0.50);

    blends = [
      { slot: AD_SLOT,  kind: 'ad',  t0: PHASES[6].t + 500,  state: 'waiting', x: 0, y: 0, alpha: 0 },
      { slot: WTF_SLOT, kind: 'wtf', t0: PHASES[6].t + 1100, state: 'waiting', x: 0, y: 0, alpha: 0 }
    ];

    var lastDock = crossAt(srv, FEED.x - 4, 0.99) + 360;
    PHASES[7].t = Math.max(lastDock, blends[1].t0 + 550) + 250;

    TL.pool = crossAt(dots, MERGE_X, 0.45);
    TL.top50 = PHASES[5].t + 600;
    TL.served = PHASES[7].t;

    // Death times of the filtered dots, for the live removal counter.
    filteredDeathTs = dots
      .filter(function (d) { return d.fate === 'filtered'; })
      .map(function (d) { return d.t0 + (GATE.filter + 6 - EMIT_X) / d.v; })
      .sort(function (a, b) { return a - b; });
  }
  var filteredDeathTs = [];

  /* ---- simulation ------------------------------------------------------- */
  /* Every dot's position is a pure function of the cycle clock `t`. Nothing
     accumulates frame to frame, so the swarm can never drift out of sync with
     the phase narration, whatever the frame rate does. */

  function ease(x) { return x * x * (3 - 2 * x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Vertical path: lane -> merged band -> (score sort) -> queue line.
  function pathY(d, x, t) {
    var y;
    if (x < MERGE_X) {
      y = lerp(d.laneY, d.bodyY, ease(clamp((x - EMIT_X) / (MERGE_X - EMIT_X), 0, 1)));
    } else {
      y = d.bodyY;
    }
    if (d.fate !== 'filtered' && x > GATE.score) {
      y = lerp(d.bodyY, d.sortY, ease(clamp((x - GATE.score) / 60, 0, 1)));
    }
    if ((d.fate === 'served' || d.fate === 'visdrop') && x > GATE.diversify + 16) {
      y = lerp(d.sortY, BAND.mid, ease(clamp((x - GATE.diversify - 16) / 90, 0, 1)));
    }
    return y + Math.sin(t * 0.0022 + d.phase) * 2.6;
  }

  // Radius follows the score once past the scoring gate.
  function radiusAt(d, x) {
    if (d.fate === 'filtered' || x <= GATE.score + 10) return 2.2;
    var k = ease(clamp((x - GATE.score - 10) / 60, 0, 1));
    return lerp(2.2, 1.5 + d.score * 2.3, k);
  }

  // Where this dot's journey ends: its death gate, or the feed for survivors.
  function endX(d) {
    return d.fate === 'filtered' ? GATE.filter + 6
         : d.fate === 'cut50'    ? GATE.diversify + 6
         : d.fate === 'visdrop'  ? GATE.visibility + 6
         : FEED.x - 4;
  }

  // Returns what to draw for a dot at time t, or null if nothing.
  function evaluate(d, t) {
    if (t < d.t0) return null;
    var x = EMIT_X + (t - d.t0) * d.v;
    var stop = endX(d);

    if (x <= stop) {
      return {
        mode: 'flow', x: x, y: pathY(d, x, t), r: radiusAt(d, x),
        alpha: clamp((t - d.t0) / 260, 0, 1),
        fill: ease(clamp((x - GATE.hydrate) / 30, 0, 1))
      };
    }

    var dtE = t - (d.t0 + (stop - EMIT_X) / d.v);

    if (d.fate === 'served') {
      var k = ease(clamp(dtE / 340, 0, 1));
      if (k >= 1) return { mode: 'docked' };
      var r = slotRect(d.slot);
      return {
        mode: 'flow', fill: 1, alpha: 1, r: radiusAt(d, stop),
        x: lerp(stop, r.x + 13, k),
        y: lerp(pathY(d, stop, t), r.y + r.h / 2, k)
      };
    }
    // Every other fate is a removal: the dot pops, it freezes at its death
    // point, shrinks and fades while a ring expands from the same centre.
    // The wobble is evaluated at the death instant so the pop holds still.
    var POP = 340;
    if (dtE >= POP) return null;
    var k = ease(clamp(dtE / POP, 0, 1));
    var tDie = d.t0 + (stop - EMIT_X) / d.v;
    return {
      mode: 'pop', k: k, fill: 1,
      x: stop, y: pathY(d, stop, tDie),
      r: radiusAt(d, stop), alpha: 1 - k
    };
  }

  function evaluateBlend(b, t) {
    if (t < b.t0) return null;
    var k = ease(clamp((t - b.t0) / 420, 0, 1));
    var r = slotRect(b.slot);
    return { alpha: k, y: lerp(FEED.y - 26, r.y + r.h / 2, k) };
  }

  /* ---- drawing ---------------------------------------------------------- */

  function label(text, x, y, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || '') + ' ' + (opts.size || 10.5) + 'px ' + MONO;
    ctx.fillStyle = opts.color || C.muted;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    ctx.fillText(text, x, y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawChrome(t) {
    // Sources.
    SOURCES.forEach(function (src) {
      var armed = t > 2600;
      label(src.name, 30, src.y - 4, {
        align: 'left', size: 11.5, weight: '700',
        color: armed ? C.ink : C.faint
      });
      label(src.sub, 30, src.y + 12, { align: 'left', size: 9.5, color: C.faint });
      // Emitter tick.
      ctx.strokeStyle = armed ? src.color : C.hair;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(EMIT_X - 8, src.y - 12);
      ctx.lineTo(EMIT_X - 8, src.y + 12);
      ctx.stroke();
    });

    // Gates: thin vertical hairlines with cap ticks and labels above. The
    // gate belonging to the current narration phase is drawn in full ink.
    var activeGate = PHASES[currentPhaseIndex(t)].gate || null;
    GATES.forEach(function (g) {
      var active = g.key === activeGate;
      ctx.strokeStyle = active ? C.faint : C.hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.x, BAND.top - 18);
      ctx.lineTo(g.x, BAND.bottom + 18);
      ctx.stroke();
      ctx.strokeStyle = active ? C.muted : C.faint;
      ctx.lineWidth = 1.4;
      [BAND.top - 18, BAND.bottom + 18].forEach(function (y) {
        ctx.beginPath();
        ctx.moveTo(g.x - 4, y);
        ctx.lineTo(g.x + 4, y);
        ctx.stroke();
      });
      label(g.name, g.x, BAND.top - 40, {
        size: 11, weight: '700', color: active ? C.ink : C.muted
      });
      label(g.sub, g.x, BAND.top - 26, {
        size: 9.2, color: active ? C.muted : C.faint
      });
    });

    // Label stores: the offline half of the system, feeding VISIBILITY.
    // A database icon, top ellipse, two seams, straight sides.
    var sx = STORES.x, sy = STORES.y;
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 9, 12, 3.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy - 9); ctx.lineTo(sx - 12, sy + 9);
    ctx.moveTo(sx + 12, sy - 9); ctx.lineTo(sx + 12, sy + 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sx, sy, 12, 3.5, 0, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sx, sy + 9, 12, 3.5, 0, 0, Math.PI, false);
    ctx.stroke();
    label('Label stores', sx, sy - 22, { size: 8.5, color: C.faint });
    // Dashed connector down toward the visibility gate, ending in a chevron
    // that stops clear of the gate's own label.
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy + 15);
    ctx.lineTo(sx, 98);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sx - 4, 99);
    ctx.lineTo(sx, 105);
    ctx.lineTo(sx + 4, 99);
    ctx.stroke();

    // Feed panel.
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 1.2;
    roundRect(FEED.x, FEED.y, FEED.w, FEED.h, 10);
    ctx.stroke();
    label('For You', FEED.x + FEED.pad, FEED.y + 24, {
      align: 'left', size: 11, weight: '700', color: C.ink
    });
    ctx.strokeStyle = C.hair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(FEED.x + FEED.pad, FEED.y + 32);
    ctx.lineTo(FEED.x + FEED.w - FEED.pad, FEED.y + 32);
    ctx.stroke();
  }

  function drawCaption(t, dyn) {
    // The numbered narration in the top-left. Crossfades between phases.
    var idx = currentPhaseIndex(t);
    var current = PHASES[idx];
    var next = PHASES[idx + 1] || null;
    var a = clamp((t - current.t) / 350, 0, 1);
    if (next) a = Math.min(a, clamp((next.t - t) / 350, 0, 1) * 0.6 + 0.4);

    ctx.globalAlpha = dyn * a;
    label(current.n, 30, 50, { align: 'left', size: 13, weight: '700', color: C.faint });
    label(current.name, 62, 50, { align: 'left', size: 13, weight: '700', color: C.ink });
    ctx.font = '10.5px ' + MONO;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.fillText(current.sub, 30, 68);
    ctx.globalAlpha = 1;
  }

  function drawRequest(t, dyn) {
    // Phase 01: the request travels from the feed back to the sources,
    // and the viewer-context checklist assembles as it lands.
    if (t < 3600) {
      var k = ease(clamp((t - 200) / 2600, 0, 1));
      var x1 = FEED.x - 6, x0 = lerp(x1, EMIT_X, k);
      var a = dyn * clamp((t - 200) / 300, 0, 1) * clamp((3600 - t) / 420, 0, 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, BAND.mid);
      ctx.lineTo(x0, BAND.mid);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x0, BAND.mid, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = C.ink;
      ctx.fill();
      label('Request', x1 + 2, BAND.mid - 12, { align: 'right', size: 9.5, color: C.muted });
      ctx.globalAlpha = 1;
    }

    // Viewer-context ticks, top-left, between the caption and the sources.
    if (t > 1400 && t < 6400) {
      var fadeOut = clamp((6400 - t) / 700, 0, 1);
      CONTEXT_TICKS.forEach(function (tick, i) {
        var ta = clamp((t - (1500 + i * 330)) / 320, 0, 1);
        if (ta <= 0) return;
        ctx.globalAlpha = dyn * ta * fadeOut;
        var y = 96 + i * 17;
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(32, y - 3);
        ctx.lineTo(35, y);
        ctx.lineTo(41, y - 7);
        ctx.stroke();
        label(tick, 50, y, { align: 'left', size: 9.5, color: C.muted });
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawTrainingLoop(t, dyn) {
    // Phase 08: the served feed is logged and loops back toward the model.
    if (t < TL.served + 500) return;
    var a = dyn * clamp((t - TL.served - 500) / 600, 0, 1);
    var lineY = 495, upX = GATE.score;
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 1;
    // Orthogonal return route, in the same hairline language as the gates:
    // out of the feed, straight across, then up into the scoring model.
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(FEED.x - 2, lineY);
    ctx.lineTo(upX + 8, lineY);
    ctx.arcTo(upX, lineY, upX, lineY - 8, 8);
    ctx.lineTo(upX, BAND.bottom + 30);
    ctx.stroke();
    ctx.setLineDash([]);
    // Departure tick on the feed edge, open chevron at the model end.
    ctx.beginPath();
    ctx.moveTo(FEED.x - 2, lineY - 4);
    ctx.lineTo(FEED.x - 2, lineY + 4);
    ctx.moveTo(upX - 4, BAND.bottom + 36);
    ctx.lineTo(upX, BAND.bottom + 29);
    ctx.lineTo(upX + 4, BAND.bottom + 36);
    ctx.stroke();
    label('Served feed is logged → tomorrow’s training data', (upX + FEED.x) / 2, lineY + 17,
          { size: 9.5, color: C.muted });
    ctx.globalAlpha = 1;
  }

  function drawRow(rect, alpha, kind, color) {
    ctx.globalAlpha = alpha;
    var cx = rect.x + 13, cy = rect.y + rect.h / 2;
    // Tagged rows (ad, who-to-follow) reserve space on the right for the tag,
    // so the skeleton lines stop short of it.
    var tagW = kind === 'post' ? 0 : 40;
    var lineW = rect.w - 26 - 10 - tagW;

    if (kind === 'post') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'ad') {
      ctx.strokeStyle = C.ad;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - 5, cy - 5, 10, 10);
    } else if (kind === 'wtf') {
      ctx.fillStyle = C.faint;
      [-5, 0, 5].forEach(function (dx) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Skeleton text lines.
    ctx.fillStyle = kind === 'post' ? 'rgba(37,150,190,0.15)' : 'rgba(17,17,17,0.09)';
    ctx.fillRect(rect.x + 26, cy - 6, lineW, 4);
    ctx.fillRect(rect.x + 26, cy + 2, lineW * 0.62, 4);

    // Tags share one right edge inside the row.
    if (kind === 'ad') {
      label('Ad', rect.x + rect.w, cy + 3, { align: 'right', size: 8.5, color: C.ad });
    } else if (kind === 'wtf') {
      label('Follow', rect.x + rect.w, cy + 3, { align: 'right', size: 8.5, color: C.faint });
    }
    ctx.globalAlpha = 1;
  }

  function drawDynamic(t) {
    var fade = t > FADE_OUT ? clamp(1 - (t - FADE_OUT) / 600, 0, 1) : 1;
    var rise = clamp(t / 300, 0, 1);
    var dyn = fade * rise;
    if (dyn <= 0) return;

    drawCaption(t, dyn);
    drawRequest(t, dyn);

    // Dots.
    dots.forEach(function (d) {
      var s = evaluate(d, t);
      if (!s || s.mode === 'docked') return;
      var a = s.alpha * dyn;
      if (a <= 0) return;

      // A ruled-out dot pops: it shrinks and fades in place while a ring
      // bursts outward from the same centre.
      if (s.mode === 'pop') {
        ctx.globalAlpha = a;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (1 - 0.6 * s.k), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + s.k * 8, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }

      if (s.fill < 1) {
        // Bare ID: hollow ring until hydration fills it.
        ctx.globalAlpha = a;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (s.fill > 0) {
        ctx.globalAlpha = a * s.fill;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // A faint tick on any gate a dot is crossing: the gates visibly work.
      for (var i = 0; i < GATES.length; i++) {
        var gx = GATES[i].x;
        if (s.x > gx - 5 && s.x < gx + 5) {
          ctx.globalAlpha = a * 0.5;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(gx, s.y - 4);
          ctx.lineTo(gx, s.y + 4);
          ctx.stroke();
          break;
        }
      }
    });
    ctx.globalAlpha = 1;

    // Feed rows.
    dots.forEach(function (d) {
      var s = evaluate(d, t);
      if (!s || s.mode !== 'docked') return;
      drawRow(slotRect(d.slot), dyn, 'post', d.color);
    });
    blends.forEach(function (b) {
      var s = evaluateBlend(b, t);
      if (!s) return;
      var r = slotRect(b.slot);
      drawRow({ x: r.x, y: s.y - r.h / 2, w: r.w, h: r.h }, s.alpha * dyn, b.kind);
    });

    // Counts, revealed as the run progresses.
    ctx.globalAlpha = dyn;
    if (t > TL.pool) {
      label('3,000–4,000 candidate IDs', (MERGE_X + EMIT_X) / 2 + 8, BAND.bottom + 44,
            { size: 10, color: C.muted });
    }
    // Live removal counter: the filters visibly eat the pool.
    var died = 0;
    while (died < filteredDeathTs.length && filteredDeathTs[died] <= t) died++;
    if (died > 0) {
      var removed = Math.round((died / filteredDeathTs.length) * 2100);
      label('− ' + removed.toLocaleString('en-US') + ' removed',
            GATE.filter, BAND.bottom + 44, { size: 10, color: C.muted });
    }
    if (t > TL.top50) {
      label('Top 50', GATE.diversify, BAND.bottom + 44, { size: 10, color: C.muted });
    }
    if (t > TL.served) {
      label('35 served', FEED.x + FEED.w / 2, FEED.y + FEED.h + 24, { size: 10, color: C.muted });
    }
    ctx.globalAlpha = 1;

    drawTrainingLoop(t, dyn);
  }

  var lastT = 0;

  function render(t) {
    lastT = t;
    ctx.clearRect(0, 0, W, H);
    drawChrome(t);
    drawDynamic(t);
  }

  /* ---- sizing ----------------------------------------------------------- */

  var scale = 1;
  function resize() {
    var cssW = canvas.clientWidth || figure.clientWidth;
    if (!cssW) return;
    var cssH = cssW * (H / W);
    // Full device resolution, uncapped: canvas text is raster, so anything
    // less than the true pixel ratio reads as soft next to the DOM text.
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = cssW / W;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }

  // Browser zoom changes devicePixelRatio without necessarily changing the
  // element's CSS size, so ResizeObserver alone misses it; re-rasterize on
  // every effective-DPR change or the canvas is left blurry at the new zoom.
  (function watchDpr() {
    if (!window.matchMedia) return;
    var mq = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    if (!mq.addEventListener) return;
    mq.addEventListener('change', function () {
      resize();
      render(lastT);
      watchDpr();
    }, { once: true });
  })();

  /* ---- notes (hover / tap) ---------------------------------------------- */

  /* The card follows the pointer on the same clock as the canvas: pointer
     moves only update a target; the main animation loop eases the card toward
     it with frame-rate-independent exponential smoothing and paints it via
     transform: translate3d (compositor-only, no layout, no jitter). The
     card's size is cached when its content changes, so pointer moves never
     force layout. When the loop isn't running (reduced motion), the card
     tracks the pointer directly. The cursor is left alone, no `help`
     question mark. */

  var note = figure.querySelector('.hero-note');
  var activeNote = null;
  var noteShown = false;
  var noteW = 0, noteH = 0;   // cached card size
  var noteTX = 0, noteTY = 0; // target position
  var noteX = 0, noteY = 0;   // rendered position

  function findNote(lx, ly) {
    for (var i = 0; i < NOTES.length; i++) {
      var r = NOTES[i].rect;
      if (lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]) return NOTES[i];
    }
    return null;
  }

  function measureNote() {
    noteW = note.offsetWidth;
    noteH = note.offsetHeight;
  }

  // Target beside the pointer, flipped and clamped to stay inside the figure.
  function aimNote(clientX, clientY) {
    var frame = figure.getBoundingClientRect();
    var x = clientX - frame.left + 16;
    var y = clientY - frame.top + 16;
    if (x + noteW > frame.width - 8) x = clientX - frame.left - noteW - 16;
    if (y + noteH > frame.height - 8) y = clientY - frame.top - noteH - 16;
    noteTX = Math.max(4, Math.min(x, frame.width - noteW - 4));
    noteTY = Math.max(4, y);
  }

  function paintNote() {
    note.style.transform =
      'translate3d(' + noteX.toFixed(1) + 'px,' + noteY.toFixed(1) + 'px,0)';
  }

  // One smoothing step, called from the main loop with the frame's dt (ms).
  function tickNote(dt) {
    if (!noteShown) return;
    var k = 1 - Math.exp(-dt / 70);
    noteX += (noteTX - noteX) * k;
    noteY += (noteTY - noteY) * k;
    paintNote();
  }

  function onPointer(ev) {
    if (!note) return;
    var rect = canvas.getBoundingClientRect();
    var n = findNote((ev.clientX - rect.left) / scale, (ev.clientY - rect.top) / scale);

    if (n !== activeNote) {
      activeNote = n;
      if (n) {
        note.querySelector('strong').textContent = n.title;
        note.querySelector('span').textContent = n.body;
        var pathEl = note.querySelector('.note-path');
        if (pathEl) {
          pathEl.textContent = n.path || '';
          pathEl.style.display = n.path ? 'block' : 'none';
        }
        measureNote(); // once per content change, never per move
      }
      note.dataset.show = n ? 'true' : 'false';
    }

    if (n) {
      var appearing = !noteShown;
      noteShown = true;
      aimNote(ev.clientX, ev.clientY);
      // Snap on first appearance (never fly in from a stale spot), and
      // whenever the animation loop isn't there to do the smoothing.
      if (appearing || !running) {
        noteX = noteTX;
        noteY = noteTY;
        paintNote();
      }
    } else {
      noteShown = false;
    }
  }

  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointerleave', function () {
    activeNote = null;
    noteShown = false;
    if (note) note.dataset.show = 'false';
  });

  /* ---- main loop -------------------------------------------------------- */

  var raf = 0, start = 0, prevNow = 0, running = false;

  function frame(now) {
    if (!start) start = now;
    var t = now - start;
    if (t >= CYCLE) {
      start = now;
      t = 0;
      cycleIndex++;
      buildCycle(20260829 + cycleIndex);
    }
    render(t);
    // The hover card shares this clock: one smoothing step per frame, capped
    // so a dropped frame can't produce a visible jump.
    tickNote(Math.min(prevNow ? now - prevNow : 16, 48));
    prevNow = now;
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() {
    buildCycle(20260829);
    render(STATIC_T);
  }

  var frozen = false;

  function play() {
    if (frozen || running || reduced.matches) return;
    running = true;
    start = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    prevNow = 0;
    cancelAnimationFrame(raf);
  }

  function boot() {
    resize();
    buildCycle(20260829 + cycleIndex);
    if (reduced.matches) { renderStatic(); return; }
    render(0);
  }

  // Resetting the canvas size wipes it, so repaint the last frame after any
  // resize, the animation loop would catch up anyway, but static and frozen
  // frames (reduced motion, __heroRender) would otherwise stay blank.
  if ('ResizeObserver' in window) {
    new ResizeObserver(function () {
      resize();
      render(lastT);
    }).observe(figure);
  } else {
    window.addEventListener('resize', function () { resize(); render(lastT); });
  }

  // Only animate while on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) play(); else pause();
      });
    }, { threshold: 0.05 }).observe(figure);
  } else {
    play();
  }

  reduced.addEventListener && reduced.addEventListener('change', function () {
    if (reduced.matches) { pause(); renderStatic(); }
    else play();
  });

  // ctx.font does not trigger @font-face loading on its own, so ask for the
  // faces explicitly; the animation redraws every frame, so they swap in as
  // soon as they arrive. The static frame is re-rendered once they are ready.
  if (document.fonts && document.fonts.load) {
    document.fonts.load('400 11px "Berkeley Mono"');
    document.fonts.load('700 11px "Berkeley Mono"');
    document.fonts.ready.then(function () {
      if (reduced.matches) renderStatic();
    });
  }

  // Dev hook: freeze the loop and render one moment of the cycle, e.g.
  // __heroRender(12600) from the console. Reload (or scroll) to resume.
  window.__heroRender = function (t) {
    frozen = true;
    pause();
    buildCycle(20260829);
    render(t);
  };

  boot();
})();
