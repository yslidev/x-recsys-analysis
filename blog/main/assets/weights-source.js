// Where the weight numbers in this article come from.
//
// Live first: raw.githubusercontent.com serves param.rs with
// `access-control-allow-origin: *`, so the browser can read X's own source on
// every page load. When X retunes a weight the article updates itself -- which
// matters, because three of these changed inside the August 2026 release
// window while we were writing.
//
// Degrade by degrees, never silently:
//   all 26 parsed  -> "live from xai-org/x-algorithm@main"
//   some parsed    -> live values, the rest from the committed snapshot,
//                     labelled "partly live, N of 26 from the snapshot"
//   none parsed    -> "snapshot at <commit>"
//   no snapshot    -> the hand-written table already in the HTML
//
// The middle case is the one that matters: if X renames or restructures part
// of param.rs, a reader should still get every weight we can still verify plus
// the closest known value for the rest, with the mixture stated -- not a blank
// table, and not a silent 19-of-26.
//
// Exposes: window.loadWeights() -> Promise<data>
//          window.weightsProvenance(data) -> string
// Tests:   tools/test_weights.mjs (node --test) drives parse()/merge() direct.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.loadWeights = api.loadWeights; root.weightsProvenance = api.provenance;
              root.__weights = api; }
}(typeof window !== 'undefined' ? window : null, function () {

  const RAW = 'https://raw.githubusercontent.com/xai-org/x-algorithm/main/home-mixer/params/param.rs';

  // param.rs name -> how a person would say it. The file holds ~63 f64 params;
  // these 26 are the action weights the value model sums.
  const LABEL = {
    ShareViaCopyLinkWeight: 'Share via copy link', ReplyWeight: 'Reply',
    ShareViaDmWeight: 'Share via DM', QuoteWeight: 'Quote',
    FollowAuthorWeight: 'Follow author', ShareWeight: 'Share',
    RetweetWeight: 'Repost', FavoriteWeight: 'Like', ClickWeight: 'Click',
    OpenLinkWeight: 'Open link', PostUnexploredWeight: 'Post unexplored',
    VideoOpenWeight: 'Video open', PhotoExpandWeight: 'Photo expand',
    QuotedClickWeight: 'Quoted click', DwellWeight: 'Dwell',
    ContDwellTimeWeight: 'Continuous dwell time',
    ProfileClickWeight: 'Profile click', VqvWeight: 'Video quality view',
    QuotedVqvWeight: 'Quoted video quality view',
    ContClickDwellTimeWeight: 'Continuous click dwell time',
    ContActiveSecs5mResidualNormWeight: 'Active seconds (5m residual)',
    NotDwelledWeight: 'Did not dwell', BlockAuthorWeight: 'Block author',
    NotInterestedWeight: 'Not interested', MuteAuthorWeight: 'Mute author',
    ReportWeight: 'Report',
  };
  const EXPECTED = Object.keys(LABEL).length;

  // Tolerant of the formatting param.rs actually uses: one line or five,
  // optional trailing comma, optional f64 suffix, exponent notation.
  const PARAM = /param!\(\s*([A-Za-z0-9_]+)\s*,\s*f64\s*,\s*"[^"]*"\s*,\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:_?f64)?\s*,?\s*\)/g;

  const round = n => Math.round(n * 1e4) / 1e4;
  const sums = rows => ({
    positive_sum: round(rows.filter(r => r.weight > 0).reduce((t, r) => t + r.weight, 0)),
    negative_sum: round(rows.filter(r => r.weight < 0).reduce((t, r) => t + r.weight, 0)),
  });

  // Pull every f64 param out of the source, then keep the ones we have a
  // label for. Returns what it found and what it could not find.
  function parse(src) {
    const found = {};
    if (typeof src === 'string') {
      PARAM.lastIndex = 0;
      let m;
      while ((m = PARAM.exec(src)) !== null) {
        const v = parseFloat(m[2]);
        if (Number.isFinite(v)) found[m[1]] = v;
      }
    }
    const rows = Object.keys(LABEL).filter(k => k in found)
      .map(k => ({ param: k, label: LABEL[k], weight: found[k], live: true }));
    return {
      rows: rows.sort((a, b) => b.weight - a.weight),
      missing: Object.keys(LABEL).filter(k => !(k in found)),
      extras: {
        bidirectional: found.BidirectionalFollowReplyWeightBoost,
        oon: found.OonWeightFactor,
        diversityDecay: found.AuthorDiversityDecay,
        diversityFloor: found.AuthorDiversityFloor,
      },
    };
  }

  // Closest approximation to date: every weight we could read live, plus the
  // last known value for any we could not.
  function merge(parsed, snapshot) {
    const snapRows = (snapshot && snapshot.weights) || [];
    const byParam = Object.fromEntries(snapRows.map(r => [r.param, r]));
    const stale = [];
    const rows = parsed.rows.slice();

    for (const key of parsed.missing) {
      const s = byParam[key];
      if (!s) continue;                       // unknown to both: leave it out
      rows.push({ param: key, label: s.label, weight: s.weight, live: false });
      stale.push(key);
    }
    rows.sort((a, b) => b.weight - a.weight);

    const live = rows.filter(r => r.live).length;
    return Object.assign({
      weights: rows,
      live: live === EXPECTED,
      partial: live > 0 && live < EXPECTED,
      live_count: live,
      expected: EXPECTED,
      stale,
      unresolved: parsed.missing.filter(k => !byParam[k]),
      extras: parsed.extras,
      commit: snapshot && snapshot.commit,
      commit_date: snapshot && snapshot.commit_date,
    }, sums(rows));
  }

  function provenance(d) {
    if (!d || !d.weights || !d.weights.length) return 'unavailable';
    if (d.live) return 'live from xai-org/x-algorithm@main';
    if (d.partial) {
      const n = d.expected - d.live_count;
      return `partly live from xai-org/x-algorithm@main — ${n} of ${d.expected}` +
             ` could not be read and are shown at their last known value` +
             (d.commit ? ` (${d.commit})` : '');
    }
    return `snapshot at ${d.commit || 'unknown'}${d.commit_date ? ` (${d.commit_date})` : ''}`;
  }

  let pending = null;

  function loadWeights(fetchImpl) {
    if (pending) return pending;
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('no fetch'));

    const snap = () => f('assets/weights.json')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .catch(() => null);

    pending = Promise.all([
      f(RAW, { cache: 'no-cache' })
        .then(r => r.ok ? r.text() : Promise.reject(r.status))
        .catch(() => null),
      snap(),
    ]).then(([src, snapshot]) => {
      const parsed = parse(src);
      const d = merge(parsed, snapshot);
      if (!d.weights.length) return Promise.reject(new Error('no weights'));
      d.fetched_at = new Date().toISOString().slice(0, 10);
      return d;
    });
    return pending;
  }

  return { parse, merge, provenance, loadWeights, LABEL, EXPECTED,
           _reset: () => { pending = null; } };
}));
