/* Hero: one For You request through the pipeline.
 *
 * A canvas animation of the candidate funnel: a request pulse sweeps from the
 * feed back to the candidate sources, dots (posts) stream through the gates
 * (hydrate -> filter -> score -> diversify -> visibility) and the survivors
 * dock into the feed panel, with an ad and a who-to-follow module blended in.
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

  var W = 1160, H = 560;
  var CYCLE = 14200;          // ms per loop
  var FADE_OUT = 13300;       // dynamic content starts fading here
  var STATIC_T = 8600;        // frame shown under prefers-reduced-motion

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---- palette ---------------------------------------------------------- */

  var C = {
    ink:     '#1b1b1b',
    muted:   'rgba(0,0,0,0.55)',
    faint:   'rgba(0,0,0,0.30)',
    hair:    'rgba(0,0,0,0.14)',
    dead:    '#b9b9b9',
    thunder: '#5f8fb4',   // in-network
    phoenix: '#d1764a',   // model retrieval
    simclus: '#6f9c6f',   // communities
    mixer:   '#997fb8',   // tweet-mixer
    ad:      '#c9a227',
    paper:   '#ffffff'
  };

  var MONO = '"Berkeley Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  /* ---- layout ----------------------------------------------------------- */

  var BAND = { top: 150, bottom: 415, mid: 282 };

  var SOURCES = [
    { key: 'thunder', name: 'THUNDER',     sub: 'people you follow',  color: C.thunder, y: 165, n: 58 },
    { key: 'phoenix', name: 'PHOENIX',     sub: 'model retrieval',    color: C.phoenix, y: 245, n: 44 },
    { key: 'simclus', name: 'SIMCLUSTERS', sub: 'communities',        color: C.simclus, y: 325, n: 32 },
    { key: 'mixer',   name: 'TWEETMIXER',  sub: 'graph expansion',    color: C.mixer,   y: 405, n: 24 }
  ];
  var EMIT_X = 208, MERGE_X = 350;

  var GATES = [
    { key: 'hydrate',   x: 398, name: 'HYDRATE',    sub: '12 hydrators' },
    { key: 'filter',    x: 512, name: 'FILTER',     sub: '18 checks' },
    { key: 'score',     x: 626, name: 'SCORE',      sub: 'phoenix + 26 weights' },
    { key: 'diversify', x: 740, name: 'DIVERSIFY',  sub: 'map-dpp · top 50' },
    { key: 'visibility',x: 852, name: 'VISIBILITY', sub: 'per-viewer rules' }
  ];
  var GATE = {};
  GATES.forEach(function (g) { GATE[g.key] = g.x; });

  var FEED = { x: 950, y: 66, w: 172, h: 448, rowH: 30, rowGap: 3, headH: 40, pad: 11 };
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

  /* ---- annotations (hover) ---------------------------------------------- */

  var NOTES = [
    { rect: [28, 135, 190, 62], title: 'Thunder · in-network',
      body: 'Every post from people you follow, from the last 48 hours, held in RAM in reverse-chronological order. No ML at this stage.' },
    { rect: [28, 215, 190, 62], title: 'Phoenix retrieval',
      body: 'A learned retrieval model picks out-of-network posts it predicts you will engage with, addressing posts by semantic IDs.' },
    { rect: [28, 295, 190, 62], title: 'SimClusters',
      body: 'Posts surfacing from ~145k communities detected by factorizing the follow graph — a 2020-era method still in the mix.' },
    { rect: [28, 375, 190, 62], title: 'TweetMixer',
      body: 'An additional recall service contributing graph-based candidate paths.' },
    { rect: [228, 150, 110, 265], title: '3,000–4,000 candidates',
      body: 'The sources return only post IDs — a wide, personalized pool of paper money. Everything after this narrows it down.' },
    { rect: [376, 120, 44, 320], title: 'Candidate hydration',
      body: '12 parallel lookups fill each ID in: text, media, author, language, engagement counts.' },
    { rect: [490, 120, 44, 320], title: '18 sequential filters',
      body: 'Older than 48 h, already seen, your own posts, blocked or muted authors, muted keywords, NSFW rules — most of the pool dies here.' },
    { rect: [604, 120, 44, 320], title: 'Phoenix scoring',
      body: 'One transformer pass predicts P(like), P(reply), P(report)… per post; 26 fixed weights fold them into a single score.' },
    { rect: [718, 120, 44, 320], title: 'Diversity re-rank',
      body: 'A MAP-DPP pass trades raw score for dissimilarity, then only the top 50 survive (TOP_K_CANDIDATES_TO_SELECT).' },
    { rect: [830, 120, 44, 320], title: 'Visibility filtering',
      body: 'Per-viewer safety rules decide allow, interstitial, or drop — the only stage that can make a post vanish for you.' },
    { rect: [800, 36, 110, 56], title: 'The other half',
      body: 'Safety labels are written continuously by a separate offline pipeline. The two halves never call each other — they only meet in these stores.' },
    { rect: [FEED.x, FEED.y, FEED.w, FEED.h], title: 'Your For You feed',
      body: '35 posts (RESULT_SIZE), blended with ads and a who-to-follow module at fixed positions, marshalled and sent back — in well under a second.' }
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
          t0: 1300 + rand() * 3000,
          v: 0.175 * (0.88 + rand() * 0.27),
          laneY: src.y + (rand() - 0.5) * 34,
          bodyY: BAND.top + 14 + rand() * (BAND.bottom - BAND.top - 28),
          phase: rand() * Math.PI * 2,
          score: rand(),
          fate: 'filtered',
          x: 0, y: 0, r: 2.1, alpha: 0, vy: 0,
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
      d.v = 0.185 + (served.length - i) * 0.004 + rand() * 0.004;
    });
    finalists.forEach(function (d) {
      if (d.fate === 'cut50') d.fate = 'pass50';
    });

    blends = [
      { slot: AD_SLOT,  kind: 'ad',  t0: 8150, state: 'waiting', x: 0, y: 0, alpha: 0 },
      { slot: WTF_SLOT, kind: 'wtf', t0: 8750, state: 'waiting', x: 0, y: 0, alpha: 0 }
    ];
  }

  /* ---- simulation ------------------------------------------------------- */

  function ease(x) { return x * x * (3 - 2 * x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function step(t, dt) {
    dots.forEach(function (d) {
      if (d.state === 'gone' || d.state === 'docked') return;

      if (d.state === 'waiting') {
        if (t < d.t0) return;
        d.state = 'flowing';
        d.x = EMIT_X;
        d.alpha = 0;
      }

      if (d.state === 'flowing') {
        d.x += d.v * dt;
        d.alpha = Math.min(1, d.alpha + dt / 260);

        // Vertical path: lane -> merged band -> (score sort) -> queue line.
        var y;
        if (d.x < MERGE_X) {
          y = lerp(d.laneY, d.bodyY, ease(clamp((d.x - EMIT_X) / (MERGE_X - EMIT_X), 0, 1)));
        } else {
          y = d.bodyY;
        }
        if (d.fate !== 'filtered' && d.x > GATE.score) {
          y = lerp(d.bodyY, d.sortY, ease(clamp((d.x - GATE.score) / 60, 0, 1)));
        }
        if ((d.fate === 'served' || d.fate === 'visdrop') && d.x > GATE.diversify + 16) {
          var qy = lerp(d.sortY, BAND.mid, ease(clamp((d.x - GATE.diversify - 16) / 90, 0, 1)));
          y = qy;
        }
        d.y = y + Math.sin(t * 0.0022 + d.phase) * 2.6;

        // Radius follows the score once scored.
        if (d.fate !== 'filtered' && d.x > GATE.score + 10) {
          d.r = lerp(d.r, 1.5 + d.score * 2.3, 0.08);
        }

        // Gate outcomes.
        if (d.fate === 'filtered' && d.x > GATE.filter + 6) {
          d.state = 'falling'; d.vy = 0.02 + Math.random() * 0.03;
        } else if (d.fate === 'cut50' && d.x > GATE.diversify + 6) {
          d.state = 'dissolving';
        } else if (d.fate === 'visdrop' && d.x > GATE.visibility + 6) {
          d.state = 'fading';
        } else if (d.fate === 'pass50' && d.x > GATE.visibility - 30) {
          // pass50 dots technically die at the top-50 gate; safety net.
          d.state = 'dissolving';
        } else if (d.fate === 'served' && d.x >= FEED.x - 4) {
          d.state = 'docking';
          d.dockT = t;
          d.fromX = d.x; d.fromY = d.y;
        }
      } else if (d.state === 'falling') {
        d.vy += dt * 0.00042;
        d.y += d.vy * dt;
        d.x += d.v * dt * 0.25;
        d.alpha -= dt / 620;
        if (d.alpha <= 0) d.state = 'gone';
      } else if (d.state === 'dissolving') {
        d.alpha -= dt / 420;
        d.r = Math.max(0.4, d.r - dt / 500);
        d.x += d.v * dt * 0.3;
        if (d.alpha <= 0) d.state = 'gone';
      } else if (d.state === 'fading') {
        d.alpha -= dt / 520;
        d.y += dt * 0.012;
        if (d.alpha <= 0) d.state = 'gone';
      } else if (d.state === 'docking') {
        var r = slotRect(d.slot);
        var k = ease(clamp((t - d.dockT) / 340, 0, 1));
        d.x = lerp(d.fromX, r.x + 13, k);
        d.y = lerp(d.fromY, r.y + r.h / 2, k);
        d.alpha = 1;
        if (k >= 1) d.state = 'docked';
      }
    });

    blends.forEach(function (b) {
      if (b.state === 'gone' || b.state === 'docked') return;
      if (b.state === 'waiting') {
        if (t < b.t0) return;
        b.state = 'docking';
      }
      var r = slotRect(b.slot);
      var k = ease(clamp((t - b.t0) / 420, 0, 1));
      b.x = r.x + 13;
      b.y = lerp(FEED.y - 26, r.y + r.h / 2, k);
      b.alpha = k;
      if (k >= 1) b.state = 'docked';
    });
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
      var armed = t > 1050;
      label(src.name, 30, src.y - 4, {
        align: 'left', size: 11, weight: '700',
        color: armed ? C.ink : C.faint
      });
      label(src.sub, 30, src.y + 11, { align: 'left', size: 9.5, color: C.faint });
      // Emitter tick.
      ctx.strokeStyle = armed ? src.color : C.hair;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(EMIT_X - 8, src.y - 12);
      ctx.lineTo(EMIT_X - 8, src.y + 12);
      ctx.stroke();
    });

    // Gates: thin vertical hairlines with cap ticks and labels above.
    GATES.forEach(function (g) {
      ctx.strokeStyle = C.hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.x, BAND.top - 18);
      ctx.lineTo(g.x, BAND.bottom + 18);
      ctx.stroke();
      ctx.strokeStyle = C.faint;
      ctx.lineWidth = 1.4;
      [BAND.top - 18, BAND.bottom + 18].forEach(function (y) {
        ctx.beginPath();
        ctx.moveTo(g.x - 4, y);
        ctx.lineTo(g.x + 4, y);
        ctx.stroke();
      });
      label(g.name, g.x, BAND.top - 40, { size: 10.5, weight: '700', color: C.muted });
      label(g.sub, g.x, BAND.top - 27, { size: 9, color: C.faint });
    });

    // Label stores: the offline half of the system, feeding VISIBILITY.
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(STORES.x, STORES.y - 7, 13, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(STORES.x - 13, STORES.y - 7); ctx.lineTo(STORES.x - 13, STORES.y + 7);
    ctx.moveTo(STORES.x + 13, STORES.y - 7); ctx.lineTo(STORES.x + 13, STORES.y + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(STORES.x, STORES.y + 7, 13, 4, 0, Math.PI, false);
    ctx.stroke();
    label('LABEL STORES', STORES.x, STORES.y - 20, { size: 8.5, color: C.faint });
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(STORES.x, STORES.y + 13);
    ctx.lineTo(STORES.x, BAND.top - 44);
    ctx.stroke();
    ctx.setLineDash([]);

    // Feed panel.
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 1.2;
    roundRect(FEED.x, FEED.y, FEED.w, FEED.h, 10);
    ctx.stroke();
    label('FOR YOU', FEED.x + FEED.pad, FEED.y + 24, {
      align: 'left', size: 11, weight: '700', color: C.ink
    });
    ctx.strokeStyle = C.hair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(FEED.x + FEED.pad, FEED.y + 32);
    ctx.lineTo(FEED.x + FEED.w - FEED.pad, FEED.y + 32);
    ctx.stroke();
  }

  function drawRow(rect, alpha, kind, color) {
    ctx.globalAlpha = alpha;
    var cx = rect.x + 13, cy = rect.y + rect.h / 2;

    if (kind === 'post') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'ad') {
      ctx.strokeStyle = C.ad;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - 5, cy - 5, 10, 10);
      label('AD', rect.x + rect.w - 2, cy + 3, { align: 'right', size: 8.5, color: C.ad });
    } else if (kind === 'wtf') {
      ctx.fillStyle = C.faint;
      [-5, 0, 5].forEach(function (dx) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      });
      label('FOLLOW', rect.x + rect.w - 2, cy + 3, { align: 'right', size: 8.5, color: C.faint });
    }

    // Skeleton text lines.
    ctx.fillStyle = kind === 'post' ? 'rgba(0,0,0,0.13)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(rect.x + 26, cy - 6, rect.w - 26 - 26, 4);
    ctx.fillRect(rect.x + 26, cy + 2, (rect.w - 26 - 26) * 0.62, 4);
    ctx.globalAlpha = 1;
  }

  function drawDynamic(t) {
    var fade = t > FADE_OUT ? clamp(1 - (t - FADE_OUT) / 600, 0, 1) : 1;
    var rise = clamp(t / 300, 0, 1);
    var dyn = fade * rise;
    if (dyn <= 0) return;

    // Request pulse: right -> left along the band's midline.
    if (t < 1500) {
      var k = ease(clamp(t / 1250, 0, 1));
      var x1 = FEED.x - 6, x0 = lerp(x1, EMIT_X, k);
      ctx.globalAlpha = dyn * clamp((1500 - t) / 320, 0, 1);
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
      label('WHO’S ASKING? · 17 LOOKUPS', (EMIT_X + FEED.x) / 2, BAND.mid - 12,
            { size: 9.5, color: C.muted });
      ctx.globalAlpha = 1;
    }

    // Dots.
    dots.forEach(function (d) {
      if (d.state === 'waiting' || d.state === 'gone' || d.state === 'docked') return;
      var a = clamp(d.alpha, 0, 1) * dyn;
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = d.state === 'falling' ? C.dead : d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Feed rows.
    dots.forEach(function (d) {
      if (d.state !== 'docked') return;
      drawRow(slotRect(d.slot), dyn, 'post', d.color);
    });
    blends.forEach(function (b) {
      if (b.state === 'waiting') return;
      var r = slotRect(b.slot);
      drawRow({ x: r.x, y: b.y - r.h / 2, w: r.w, h: r.h }, b.alpha * dyn, b.kind);
    });

    // Counts, revealed as the run progresses.
    ctx.globalAlpha = dyn;
    if (t > 3400) {
      label('3,000–4,000 CANDIDATE IDS', (MERGE_X + EMIT_X) / 2 + 8, BAND.bottom + 44,
            { size: 9.5, color: clamp((t - 3400) / 400, 0, 1) > 0.5 ? C.muted : C.faint });
    }
    if (t > 6600) {
      label('TOP 50', GATE.diversify, BAND.bottom + 44, { size: 9.5, color: C.muted });
    }
    if (t > 9300) {
      label('35 SERVED', FEED.x + FEED.w / 2, FEED.y + FEED.h + 24, { size: 9.5, color: C.muted });
    }
    ctx.globalAlpha = 1;
  }

  function render(t) {
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
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = cssW / W;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }

  /* ---- notes (hover / tap) ---------------------------------------------- */

  var note = figure.querySelector('.hero-note');
  var activeNote = null;

  function findNote(lx, ly) {
    for (var i = 0; i < NOTES.length; i++) {
      var r = NOTES[i].rect;
      if (lx >= r[0] && lx <= r[0] + r[2] && ly >= r[1] && ly <= r[1] + r[3]) return NOTES[i];
    }
    return null;
  }

  function showNote(n, clientX, clientY) {
    if (!note) return;
    if (n === activeNote) return;
    activeNote = n;
    if (!n) { note.dataset.show = 'false'; return; }
    note.querySelector('strong').textContent = n.title;
    note.querySelector('span').textContent = n.body;
    note.dataset.show = 'true';
    var frame = figure.getBoundingClientRect();
    var x = clientX - frame.left + 14;
    var y = clientY - frame.top + 14;
    // Keep the card inside the figure.
    note.style.left = '0px'; note.style.top = '0px';
    var nw = note.offsetWidth, nh = note.offsetHeight;
    if (x + nw > frame.width - 8) x = clientX - frame.left - nw - 14;
    if (y + nh > frame.height - 8) y = frame.height - nh - 8;
    note.style.left = Math.max(4, x) + 'px';
    note.style.top = Math.max(4, y) + 'px';
  }

  function onPointer(ev) {
    var rect = canvas.getBoundingClientRect();
    var lx = (ev.clientX - rect.left) / scale;
    var ly = (ev.clientY - rect.top) / scale;
    var n = findNote(lx, ly);
    canvas.style.cursor = n ? 'help' : 'default';
    showNote(n, ev.clientX, ev.clientY);
  }

  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointerleave', function () { showNote(null); });

  /* ---- main loop -------------------------------------------------------- */

  var raf = 0, start = 0, last = 0, running = false;

  function frame(now) {
    if (!start) { start = now; last = now; }
    var t = now - start;
    if (t >= CYCLE) {
      start = now;
      t = 0;
      last = now;
      cycleIndex++;
      buildCycle(20260829 + cycleIndex);
    }
    var dt = Math.min(now - last, 48);
    last = now;
    step(t, dt);
    render(t);
    raf = requestAnimationFrame(frame);
  }

  function renderStatic() {
    buildCycle(20260829);
    var t = 0, dt = 16;
    while (t < STATIC_T) { t += dt; step(t, dt); }
    render(STATIC_T);
  }

  function play() {
    if (running || reduced.matches) return;
    running = true;
    start = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function boot() {
    resize();
    buildCycle(20260829 + cycleIndex);
    if (reduced.matches) { renderStatic(); return; }
    render(0);
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(function () {
      resize();
      if (reduced.matches) renderStatic();
    }).observe(figure);
  } else {
    window.addEventListener('resize', function () { resize(); });
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

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (reduced.matches) renderStatic();
    });
  }

  boot();
})();
