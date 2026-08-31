// Failure tests for the live weights pipeline.
//
//   node --test tools/test_weights.mjs
//
// The article reads X's param.rs from raw.githubusercontent on every page
// load. That file is not ours and it changes -- three weights moved inside the
// August 2026 release window alone. These tests pin down what the article does
// when it changes in ways that break the parse: the reader must always get
// every weight we can still verify, the last known value for any we cannot,
// and an honest label saying which is which. Never a blank table, never a
// silent 19-of-26.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const W = require(join(HERE, '../assets/weights-source.js'));

const SNAPSHOT = JSON.parse(readFileSync(join(HERE, '../assets/weights.json'), 'utf8'));

const p = (name, val) => `param!(${name}, f64, "rust_home_mixer_x", ${val});`;
const REAL = Object.keys(W.LABEL).map((k, i) => p(k, i === 0 ? -234.0 : (i % 7) + 0.5)).join('\n');

const load = (src, snapshot = SNAPSHOT) => W.merge(W.parse(src), snapshot);

// ---------------------------------------------------------------- happy path

test('parses every action weight out of a well-formed param.rs', () => {
  const d = load(REAL);
  assert.equal(d.weights.length, W.EXPECTED);
  assert.equal(d.live_count, W.EXPECTED);
  assert.ok(d.live);
  assert.ok(!d.partial);
  assert.match(W.provenance(d), /^live from/);
});

test('reads the real committed param.rs shape, multiline macros included', () => {
  const src = `
param!(FavoriteWeight, f64, "rust_home_mixer_favorite_weight", 0.5);
param!(
    ShareViaCopyLinkWeight,
    f64,
    "rust_home_mixer_share_via_copy_link_weight",
    20.0
);
param!(ReportWeight, f64, "rust_home_mixer_report_weight", -234.0);`;
  const { rows } = W.parse(src);
  assert.deepEqual(rows.map(r => r.weight), [20.0, 0.5, -234.0]);
});

test('sorts descending and computes both sums', () => {
  // no snapshot: sums must reflect exactly what was parsed, nothing backfilled
  const d = load(p('FavoriteWeight', 0.5) + p('ReportWeight', -234.0) + p('ReplyWeight', 5.0), null);
  assert.deepEqual(d.weights.slice(0, 3).map(r => r.label), ['Reply', 'Like', 'Report']);
  assert.equal(d.positive_sum, 5.5);
  assert.equal(d.negative_sum, -234);
});

// ------------------------------------------------- format changes we survive

test('tolerates f64 suffixes, exponent notation and trailing commas', () => {
  const src = [
    'param!(FavoriteWeight, f64, "k", 0.5_f64,)',
    'param!(ReplyWeight, f64, "k", 5e0)',
    'param!(ReportWeight, f64, "k", -2.34e2)',
  ].join('\n');
  const { rows } = W.parse(src);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.param === 'ReportWeight').weight, -234);
});

test('ignores the other ~37 f64 params in the file', () => {
  const d = load(REAL + '\n' + p('ShadowTrafficDefaultPercent', 0.3) + p('OonWeightFactor', 0.75));
  assert.equal(d.weights.length, W.EXPECTED);
  assert.equal(d.extras.oon, 0.75);
});

// --------------------------------------- partial breakage: the important one

test('a renamed weight falls back to its last known value, not to nothing', () => {
  // X renames FavoriteWeight -> LikeWeight. 25 still parse.
  const src = REAL.replace('param!(FavoriteWeight,', 'param!(LikeWeight,');
  const d = load(src);

  assert.equal(d.weights.length, W.EXPECTED, 'reader still sees all 26 rows');
  assert.equal(d.live_count, W.EXPECTED - 1);
  assert.ok(d.partial);
  assert.deepEqual(d.stale, ['FavoriteWeight']);

  const like = d.weights.find(r => r.param === 'FavoriteWeight');
  assert.equal(like.live, false, 'the stale row is flagged, not disguised as live');
  assert.equal(like.weight, SNAPSHOT.weights.find(r => r.param === 'FavoriteWeight').weight);
});

test('partial provenance states the mixture out loud', () => {
  const d = load(REAL.replace('param!(ReportWeight,', 'param!(FlagWeight,'));
  const s = W.provenance(d);
  assert.match(s, /partly live/);
  assert.match(s, /1 of 26/);
  assert.match(s, /last known value/);
});

test('a weight unknown to both live and snapshot is dropped, not invented', () => {
  const src = REAL.replace('param!(ReportWeight,', 'param!(FlagWeight,');
  const thin = { ...SNAPSHOT, weights: SNAPSHOT.weights.filter(r => r.param !== 'ReportWeight') };
  const d = load(src, thin);
  assert.equal(d.weights.length, W.EXPECTED - 1);
  assert.deepEqual(d.unresolved, ['ReportWeight']);
  assert.ok(!d.weights.some(r => r.param === 'ReportWeight'));
});

// ------------------------------------------------- total breakage -> snapshot

test('a restructured macro yields the snapshot, fully labelled', () => {
  // param! replaced with a different macro shape entirely.
  const src = Object.keys(W.LABEL).map(k => `weight!(${k}, 0.5);`).join('\n');
  const d = load(src);
  assert.equal(d.live_count, 0);
  assert.ok(!d.live && !d.partial);
  assert.equal(d.weights.length, SNAPSHOT.weights.length);
  assert.match(W.provenance(d), /^snapshot at/);
});

test('type change from f64 is treated as breakage, not parsed loosely', () => {
  const src = Object.keys(W.LABEL).map(k => `param!(${k}, f32, "k", 0.5);`).join('\n');
  assert.equal(W.parse(src).rows.length, 0);
});

test.each = null;
for (const [name, src] of [
  ['empty file', ''],
  ['html error page', '<!doctype html><title>404</title>'],
  ['null (network failure)', null],
  ['truncated mid-macro', 'param!(FavoriteWeight, f64, "k",'],
]) {
  test(`${name} falls back to the snapshot`, () => {
    const d = load(src);
    assert.equal(d.live_count, 0);
    assert.equal(d.weights.length, SNAPSHOT.weights.length);
    assert.match(W.provenance(d), /^snapshot/);
  });
}

test('both sources gone leaves nothing to render, and says so', () => {
  const d = load(null, null);
  assert.equal(d.weights.length, 0);
  assert.equal(W.provenance(d), 'unavailable');
});

// --------------------------------------------------------------- value drift

test('a retuned weight is reported live, with no stale marker', () => {
  // exactly what happened on 2026-08-25: DwellWeight 0.0 -> 0.05
  const d = load(REAL.replace(/param!\(DwellWeight, f64, "[^"]*", [^)]*\)/, p('DwellWeight', 0.05).slice(0, -1)));
  const dwell = d.weights.find(r => r.param === 'DwellWeight');
  assert.equal(dwell.weight, 0.05);
  assert.equal(dwell.live, true);
  assert.deepEqual(d.stale, []);
});

test('a sign flip is carried through to the sums', () => {
  const d = load(p('FavoriteWeight', -0.5) + p('ReplyWeight', 5.0), null);
  assert.equal(d.negative_sum, -0.5);
  assert.equal(d.positive_sum, 5);
});

// ----------------------------------------------------------------- end-to-end

test('loadWeights merges live and snapshot through a stubbed fetch', async () => {
  W._reset();
  const src = REAL.replace('param!(ReplyWeight,', 'param!(RespondWeight,');
  const fake = url => Promise.resolve(
    String(url).includes('raw.githubusercontent')
      ? { ok: true, text: () => Promise.resolve(src) }
      : { ok: true, json: () => Promise.resolve(SNAPSHOT) });
  const d = await W.loadWeights(fake);
  assert.equal(d.weights.length, W.EXPECTED);
  assert.ok(d.partial);
  assert.deepEqual(d.stale, ['ReplyWeight']);
  W._reset();
});

test('loadWeights survives the live source being unreachable', async () => {
  W._reset();
  const fake = url => String(url).includes('raw.githubusercontent')
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(SNAPSHOT) });
  const d = await W.loadWeights(fake);
  assert.equal(d.live_count, 0);
  assert.equal(d.weights.length, SNAPSHOT.weights.length);
  W._reset();
});
