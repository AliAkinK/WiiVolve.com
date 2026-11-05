import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectItems, sortItems, applyCaps, applyWindow, pickLive, latestDolphin, toItem, sourceRank } from '../scripts/lib/select.mjs';
import { compileExcludes } from '../scripts/lib/filter.mjs';
import { itemId, isoSeconds } from '../scripts/lib/util.mjs';

const NOW = Date.UTC(2026, 10, 4, 17, 0, 0);
const H = 3600e3;
const D = 24 * H;
const at = (msAgo) => isoSeconds(NOW - msAgo);

const sources = [
  { id: 'nintendolife', name: 'Nintendo Life', tab: 'press', filter: 'keywords', priority: 2, url: 'https://nl.example/feed' },
  { id: 'googlenews', name: 'Google News', tab: 'press', filter: 'keywords', aggregator: true, priority: 5, url: 'https://gn.example/rss' },
  { id: 'reddit-wii', name: 'r/wii', tab: 'scene', filter: 'none', priority: 1, url: 'https://reddit.example/rss' },
  { id: 'dolphin', name: 'Dolphin Emulator', tab: 'scene', filter: 'none', priority: 3, url: 'https://dolphin.example/feed' },
  { id: 'capped', name: 'Capped', tab: 'scene', filter: 'none', priority: 1, maxItems: 2, url: 'https://capped.example/feed' },
];
const selection = { windowDays: 14, minItems: 3, maxAgeDays: 400, maxItems: 60, maxPerSource: 60 };
const excludes = compileExcludes(['megathread']);

let n = 0;
function mk(over = {}) {
  n++;
  const url = over.url ?? `https://example.com/item/${n}`;
  const published = over.published ?? at(n * H);
  return toItem({
    id: over.id ?? itemId(url),
    title: over.title ?? `Wii story ${n}`,
    url,
    source: over.source ?? 'Nintendo Life',
    sourceId: over.sourceId ?? 'nintendolife',
    via: over.via,
    tab: over.tab ?? 'press',
    published,
    firstSeen: over.firstSeen ?? published,
    excerpt: over.excerpt ?? '',
    matched: over.matched ?? ['Wii'],
  });
}
const select = (args) => selectItems({ sources, selection, excludes, now: NOW, ...args });

test('toItem puts keys in contract order and only sets via when present', () => {
  const it = mk({ via: undefined });
  assert.deepEqual(Object.keys(it), ['id', 'title', 'url', 'source', 'sourceId', 'tab', 'published', 'firstSeen', 'excerpt', 'matched']);
  const g = mk({ sourceId: 'googlenews', source: 'BGR', via: 'Google News' });
  assert.deepEqual(Object.keys(g), ['id', 'title', 'url', 'source', 'sourceId', 'via', 'tab', 'published', 'firstSeen', 'excerpt', 'matched']);
});

test('aggregators always rank below publishers, whatever their priority number', () => {
  assert.ok(sourceRank(sources[1]) < sourceRank(sources[2]));
  assert.ok(sourceRank(sources[3]) > sourceRank(sources[0]));
});

test('dedupe by id: the fresh copy wins, the earliest firstSeen is kept', () => {
  const url = 'https://example.com/same';
  const prev = mk({ url, title: 'Old title', published: at(3 * H), firstSeen: at(2 * H) });
  const fresh = mk({ url, title: 'Edited title', published: at(3 * H), firstSeen: at(0) });
  const { items } = select({ previous: [prev], fresh: [fresh] });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Edited title');
  assert.equal(items[0].firstSeen, at(2 * H));
});

test('dedupe by title: the publisher copy beats the aggregator copy and keeps the earliest firstSeen', () => {
  const nl = mk({ title: 'Wii Sports Turns 20', published: at(5 * H), firstSeen: at(1 * H) });
  const google = mk({ title: 'Wii Sports turns 20!', source: 'Nintendo Life', sourceId: 'googlenews', via: 'Google News', published: at(6 * H), firstSeen: at(4 * H) });
  const { items, all } = select({ fresh: [google, nl] });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceId, 'nintendolife');
  assert.equal(items[0].via, undefined);
  assert.equal(items[0].firstSeen, at(4 * H));
  assert.equal(all.length, 1);
});

test('dedupe by title strips a trailing " - Publisher"', () => {
  const nl = mk({ title: 'Dolphin adds Triforce support for arcade games' });
  const reddit = mk({ title: 'Dolphin adds Triforce support for arcade games - Nintendo Life', source: 'r/wii', sourceId: 'reddit-wii', tab: 'scene' });
  const { items } = select({ fresh: [nl, reddit] });
  assert.deepEqual(items.map((i) => i.sourceId), ['nintendolife']);
});

test('two publishers merge by title only for a specific headline (5 words or more); short generic titles stay apart', () => {
  const post = (title, sourceId, n) => mk({ title, source: sourceId, sourceId, tab: 'scene', url: `https://reddit.example/${sourceId}/${n}` });
  const short = select({ fresh: [post('Help!', 'reddit-wii', 1), post('Help', 'dolphin', 2), post('Is this legit?', 'reddit-wii', 3), post('Is this legit?', 'dolphin', 4)] });
  assert.equal(short.items.length, 4, 'four different posts');
  const cross = select({ fresh: [post('My homebrew Wii port of Doom is finally out', 'reddit-wii', 5), post('My homebrew Wii port of Doom is finally out', 'dolphin', 6)] });
  assert.equal(cross.items.length, 1, 'a crosspost is one story');
});

test('two different posts with the same title from one publisher are both kept', () => {
  const a = mk({ title: 'Help', source: 'r/wii', sourceId: 'reddit-wii', tab: 'scene', url: 'https://reddit.example/1' });
  const b = mk({ title: 'Help!', source: 'r/wii', sourceId: 'reddit-wii', tab: 'scene', url: 'https://reddit.example/2' });
  const g = mk({ title: 'Help', source: 'Some Site', sourceId: 'googlenews', via: 'Google News', url: 'https://gn.example/3' });
  const { items } = select({ fresh: [a, b, g] });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.sourceId === 'reddit-wii'));
});

test('the same headline from two aggregator publishers collapses into one', () => {
  const a = mk({ title: 'Nintendo Wii is 20', source: 'BGR', sourceId: 'googlenews', via: 'Google News' });
  const b = mk({ title: 'Nintendo Wii Is 20', source: 'CNET', sourceId: 'googlenews', via: 'Google News' });
  assert.equal(select({ fresh: [a, b] }).items.length, 1);
});

test('candidates are reconciled with the config', () => {
  const unknown = mk({ sourceId: 'gone' });
  const excluded = mk({ title: 'Official Wii MEGATHREAD' });
  const js = mk({ url: 'javascript:alert(1)', id: 'abcabcabcabc' });
  const relabelled = mk({ tab: 'scene', source: 'Old Name' });
  const agg = mk({ sourceId: 'googlenews', source: 'BGR', tab: 'scene' });
  const broken = { ...mk(), published: 'nope', firstSeen: 'nope' };
  const half = { ...mk(), published: 'nope' };
  const { items } = select({ previous: [unknown, excluded, js, relabelled, agg, broken, half] });
  const ids = items.map((i) => i.id);
  assert.ok(!ids.includes(unknown.id) && !ids.includes(excluded.id) && !ids.includes(js.id) && !ids.includes(broken.id));
  const r = items.find((i) => i.id === relabelled.id);
  assert.equal(r.tab, 'press');
  assert.equal(r.source, 'Nintendo Life');
  const g = items.find((i) => i.id === agg.id);
  assert.equal(g.source, 'BGR');
  assert.equal(g.via, 'Google News');
  assert.equal(g.tab, 'press');
  const h = items.find((i) => i.id === half.id);
  assert.equal(h.published, h.firstSeen, 'an unusable published date falls back to firstSeen');
});

test('sort: published desc, then firstSeen desc, then id', () => {
  const p = at(H);
  const a = { ...mk({ published: p, firstSeen: at(2 * H) }), id: 'bbbbbbbbbbbb' };
  const b = { ...mk({ published: p, firstSeen: at(0) }), id: 'cccccccccccc' };
  const c = { ...mk({ published: p, firstSeen: at(2 * H) }), id: 'aaaaaaaaaaaa' };
  const d = mk({ published: at(0) });
  assert.deepEqual(sortItems([a, b, c, d]).map((i) => i.id), [d.id, 'cccccccccccc', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
});

test('per-source caps keep the newest items; a source may override the cap', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const list = sortItems([
    ...[1, 2, 3, 4, 5].map((h) => mk({ published: at(h * H) })),
    ...[1, 2, 3].map((h) => mk({ sourceId: 'capped', source: 'Capped', tab: 'scene', published: at(h * H + 1000) })),
  ]);
  const capped = applyCaps(list, byId, 3);
  assert.equal(capped.filter((i) => i.sourceId === 'nintendolife').length, 3);
  assert.equal(capped.filter((i) => i.sourceId === 'capped').length, 2);
  assert.deepEqual(capped.filter((i) => i.sourceId === 'nintendolife').map((i) => i.published), [at(H), at(2 * H), at(3 * H)]);
});

test('window: fresh items, topped up to minItems with older ones, never older than maxAgeDays, capped at maxItems', () => {
  const fresh = [1, 2].map((d) => mk({ published: at(d * D) }));
  const older = [20, 30, 40].map((d) => mk({ published: at(d * D) }));
  const ancient = mk({ published: at(500 * D) });
  const sorted = sortItems([...fresh, ...older, ancient]);
  const rules = { windowDays: 14, minItems: 3, maxAgeDays: 400, maxItems: 60 };
  assert.deepEqual(applyWindow(sorted, rules, NOW).map((i) => i.id), [fresh[0].id, fresh[1].id, older[0].id]);
  assert.equal(applyWindow(sorted, { ...rules, minItems: 1 }, NOW).length, 2, 'enough fresh items: no top-up');
  assert.equal(applyWindow(sorted, { ...rules, minItems: 50 }, NOW).length, 5, 'ancient items never come back');
  assert.equal(applyWindow(sorted, { ...rules, minItems: 50, maxItems: 4 }, NOW).length, 4);
  const many = sortItems([1, 2, 3, 4, 5, 6].map((h) => mk({ published: at(h * H) })));
  assert.equal(applyWindow(many, { ...rules, maxItems: 4 }, NOW).length, 4);
});

test('top-up is source-diverse: the source with the fewest items shown goes first, ties by the newer item, then sourceId', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days, extra = {}) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D), ...extra });
  // Fresh: two community posts and one aggregator item. Older: the aggregator is busy, Dolphin and a quiet source are not.
  const fresh = [item('reddit-wii', 1), item('reddit-wii', 2), item('googlenews', 3, { via: 'Google News' })];
  const gn = [20, 21, 22, 23].map((d) => item('googlenews', d, { via: 'Google News' }));
  const dol = [40, 90].map((d) => item('dolphin', d));
  const quiet = [200].map((d) => item('capped', d));
  const sorted = sortItems([...fresh, ...gn, ...dol, ...quiet]);
  const rules = { windowDays: 14, minItems: 7, maxAgeDays: 400, maxItems: 60 };
  const out = applyWindow(sorted, rules, NOW);
  // Picks: dolphin (0 shown, newer head than capped), capped (0), googlenews (1, newest head), dolphin (1).
  assert.deepEqual(out.map((i) => i.id), sortItems([...fresh, gn[0], dol[0], dol[1], quiet[0]]).map((i) => i.id));
  assert.deepEqual(out.map((i) => i.published), [...out].map((i) => i.published).sort().reverse(), 'the page stays sorted by date');
  // The old rule (newest older items first) would have taken four Google News items.
  const counts = (list) => list.reduce((m, i) => ((m[i.sourceId] = (m[i.sourceId] || 0) + 1), m), {});
  assert.deepEqual(counts(out), { 'reddit-wii': 2, googlenews: 2, dolphin: 2, capped: 1 });

  // Ties on count and date fall to the sourceId, so the result never depends on input order.
  const same = at(30 * D);
  const tieA = item('dolphin', 30, { published: same });
  const tieB = item('capped', 30, { published: same });
  const one = { ...rules, minItems: 1 };
  assert.deepEqual(applyWindow(sortItems([tieB, tieA]), one, NOW).map((i) => i.sourceId), ['capped']);
  assert.deepEqual(applyWindow(sortItems([tieA, tieB]), one, NOW).map((i) => i.sourceId), ['capped']);
});

test('top-up respects maxAgeDays, maxItems and the per-source caps applied before it', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D) });
  const pool = sortItems([
    ...[20, 21, 22, 23, 24].map((d) => item('capped', d)), // the source's own maxItems is 2
    ...[30, 401, 500].map((d) => item('dolphin', d)), // 401 and 500 days are past maxAgeDays
    item('nintendolife', 1),
  ]);
  const rules = { windowDays: 14, minItems: 50, maxAgeDays: 400, maxItems: 60, maxPerSource: 60 };
  const capped = applyCaps(pool, byId, rules.maxPerSource);
  const out = applyWindow(capped, rules, NOW);
  assert.equal(out.filter((i) => i.sourceId === 'capped').length, 2, 'per-source maxItems holds');
  assert.equal(out.filter((i) => i.sourceId === 'dolphin').length, 1, 'nothing older than maxAgeDays');
  assert.equal(out.length, 4);
  assert.equal(applyWindow(capped, { ...rules, maxItems: 3 }, NOW).length, 3, 'maxItems caps the topped-up list');
  assert.equal(applyWindow(capped, { ...rules, minItems: 0 }, NOW).length, 1, 'no top-up when the window is full enough');
});

test('floors (D8): every source shows its two newest, every tab eight, even when the window alone is full', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days, extra = {}) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D), ...extra });
  const rules = { windowDays: 14, minItems: 30, maxAgeDays: 400, maxItems: 60, maxPerSource: 12, minPerSource: 2, minPerTab: 8 };
  const counts = (list) => list.reduce((m, i) => ((m[i.sourceId] = (m[i.sourceId] || 0) + 1), m), {});
  // An anniversary week: three busy sources fill 36 slots inside the window, more than minItems on their own.
  const busy = ['reddit-wii', 'nintendolife', 'googlenews'].flatMap((id) => Array.from({ length: 15 }, (_, i) => item(id, 0.1 + i * 0.8, id === 'googlenews' ? { via: 'Google News' } : {})));
  const dolphin = [30, 60, 90].map((d) => item('dolphin', d));
  const quiet = [100, 200, 300].map((d) => item('capped', d)); // its own maxItems is 2
  const ancient = item('dolphin', 450); // past maxAgeDays: never
  const all = sortItems([...busy, ...dolphin, ...quiet, ancient]);
  const { items } = pickLive(all, byId, rules, NOW);
  assert.deepEqual(counts(items), { 'reddit-wii': 12, nintendolife: 12, googlenews: 12, dolphin: 2, capped: 2 });
  assert.deepEqual(items.filter((i) => i.sourceId === 'dolphin').map((i) => i.id), dolphin.slice(0, 2).map((i) => i.id), 'its two newest');
  assert.ok(!items.includes(ancient));
  assert.deepEqual(items.map((i) => i.published), [...items].map((i) => i.published).sort().reverse(), 'sorted by date');
  // Without the floors this week would have no Dolphin at all (the window is full, so the top-up never runs).
  assert.equal(counts(pickLive(all, byId, { ...rules, minPerSource: 0, minPerTab: 0 }, NOW).items).dolphin, undefined);
  // Deterministic and hour-independent: any input order, and a later hour that moves no story across the window.
  assert.deepEqual(pickLive(sortItems([...all].reverse()), byId, rules, NOW).items.map((i) => i.id), items.map((i) => i.id));
  assert.deepEqual(pickLive(all, byId, rules, NOW + 50 * 60e3).items.map((i) => i.id), items.map((i) => i.id));

  // A thin Press tab (today's data): two Google News stories in the window, more of them further back.
  const thin = sortItems([
    ...Array.from({ length: 24 }, (_, i) => item('reddit-wii', 0.2 + i * 0.5)),
    ...[3, 9, 20, 40, 60, 80, 100, 150, 200, 250, 300].map((d) => item('googlenews', d, { via: 'Google News' })),
  ]);
  const t = pickLive(thin, byId, { ...rules, minItems: 20 }, NOW).items;
  assert.deepEqual(counts(t), { 'reddit-wii': 12, googlenews: 8 }, 'Press is topped up to eight from its own older stories');
  assert.deepEqual(t.filter((i) => i.tab === 'press').map((i) => i.published), thin.filter((i) => i.tab === 'press').slice(0, 8).map((i) => i.published), 'newest first');
});

test('floors: a tab floor is shared source by source; caps hold unless only a capped source can fill it', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days, extra = {}) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D), ...extra });
  const rules = { windowDays: 14, minItems: 0, maxAgeDays: 400, maxItems: 60, maxPerSource: 12, minPerSource: 0, minPerTab: 4 };
  // Press: two sources with older stories only. The floor alternates between them (fewest first, newer head).
  const nl = [20, 30, 40].map((d) => item('nintendolife', d));
  const gn = [21, 22, 23].map((d) => item('googlenews', d, { via: 'Google News' }));
  const press = pickLive(sortItems([...nl, ...gn]), byId, rules, NOW).items;
  assert.deepEqual(press.map((i) => i.id), sortItems([nl[0], nl[1], gn[0], gn[1]]).map((i) => i.id));
  // Scene: "capped" allows 2. With Dolphin in the tab, Dolphin fills the floor; alone, capped goes past its cap.
  const cap = [20, 21, 22, 23].map((d) => item('capped', d));
  const dol = [40, 41].map((d) => item('dolphin', d));
  const withDolphin = pickLive(sortItems([...cap, ...dol]), byId, rules, NOW).items;
  assert.deepEqual(withDolphin.reduce((m, i) => ((m[i.sourceId] = (m[i.sourceId] || 0) + 1), m), {}), { capped: 2, dolphin: 2 });
  assert.equal(pickLive(sortItems(cap), byId, rules, NOW).items.length, 4, 'the only source of the tab may pass its cap');
  // minPerSource never overrides a source's own smaller maxItems.
  assert.equal(pickLive(sortItems(cap), byId, { ...rules, minPerTab: 0, minPerSource: 3 }, NOW).items.length, 2);
});

test('the maxItems cap drops the oldest window stories first, so the floors hold', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days, extra = {}) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D), ...extra });
  const reddit = Array.from({ length: 10 }, (_, i) => item('reddit-wii', 0.5 + i));
  const dol = [30, 31].map((d) => item('dolphin', d));
  const rules = { windowDays: 14, minItems: 5, maxAgeDays: 400, maxItems: 6, maxPerSource: 60, minPerSource: 2, minPerTab: 0 };
  const { items, completeSince } = pickLive(sortItems([...reddit, ...dol]), byId, rules, NOW);
  assert.deepEqual(items.map((i) => i.id), [...reddit.slice(0, 4), ...dol].map((i) => i.id));
  // The fifth r/wii post was left out inside the window: the list is complete only above it, in All and in Scene.
  assert.equal(completeSince.all, reddit[4].published);
  assert.equal(completeSince.scene, reddit[4].published);
  assert.equal(completeSince.press, isoSeconds(NOW - 14 * D), 'nothing left out of Press: complete back to the window start');
});

test('completeSince: a capped source leaves out its next story; picks from further back never count as complete', () => {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const item = (sourceId, days, extra = {}) => mk({ sourceId, source: byId.get(sourceId).name, tab: byId.get(sourceId).tab, published: at(days * D), ...extra });
  const nl = Array.from({ length: 5 }, (_, i) => item('nintendolife', 1 + i * 2)); // days 1, 3, 5, 7, 9
  const reddit = [2, 12].map((d) => item('reddit-wii', d));
  const old = item('dolphin', 40);
  const rules = { windowDays: 14, minItems: 0, maxAgeDays: 400, maxItems: 60, maxPerSource: 3, minPerSource: 1, minPerTab: 0 };
  const r = selectItems({ fresh: [...nl, ...reddit, old], sources, selection: rules, excludes, now: NOW });
  assert.equal(r.windowStart, isoSeconds(NOW - 14 * D));
  assert.equal(r.completeSince.press, nl[3].published, 'Nintendo Life showed 3 of 5: its fourth sets the line');
  assert.equal(r.completeSince.all, nl[3].published);
  assert.equal(r.completeSince.scene, r.windowStart, 'r/wii showed all it had in the window');
  assert.ok(r.items.includes(r.items.find((i) => i.id === old.id)), 'the Dolphin pick from further back is shown');
  assert.ok(old.published < r.windowStart);
});

test('selectItems: accumulation keeps previous items alongside fresh and cached ones', () => {
  const previous = [mk({ published: at(3 * D) })];
  const cached = [mk({ sourceId: 'reddit-wii', source: 'r/wii', tab: 'scene', published: at(2 * D) })];
  const fresh = [mk({ published: at(H) })];
  const { items, counts } = select({ previous, cached, fresh });
  assert.equal(items.length, 3);
  assert.deepEqual(counts, { press: 2, scene: 1 });
});

test('Dolphin chip: newest "Release NNNN" wins, previous value kept when nothing newer', () => {
  const dolphin = (title, ago) => mk({ title, sourceId: 'dolphin', source: 'Dolphin Emulator', tab: 'scene', published: at(ago), url: `https://dolphin.example/${encodeURIComponent(title)}` });
  const r2609 = dolphin('Dolphin Progress Report: Release 2609', 40 * D);
  const r2606 = dolphin('Dolphin Progress Report: Release 2606', 130 * D);
  const other = dolphin('Rise of the Triforce', 10 * D);
  assert.deepEqual(latestDolphin([other, r2606, r2609]), { version: '2609', url: r2609.url, published: r2609.published });
  const both = dolphin('Dolphin Progress Report: Release 2407 and 2409', 700 * D);
  assert.equal(latestDolphin([both]).version, '2409');
  const prev = { version: '2612', url: 'https://dolphin.example/2612', published: at(5 * D) };
  assert.deepEqual(latestDolphin([other], prev), prev, 'none this run: keep the previous chip');
  assert.deepEqual(latestDolphin([r2609], prev), prev, 'an older release does not replace a newer chip');
  assert.equal(latestDolphin([mk({ title: 'Release 2700 of something else' })]), null, 'only the dolphin source counts');
  assert.equal(latestDolphin([], { version: 2, url: 'javascript:x' }), null, 'a malformed previous chip is dropped');
  const { dolphin: chip, items } = select({ fresh: [r2609, mk()], selection: { ...selection, windowDays: 1, minItems: 1 } });
  assert.equal(chip.version, '2609', 'the chip comes from all candidates, shown or not');
  assert.ok(!items.some((i) => i.id === r2609.id));
});
