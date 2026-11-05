import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileKeywords, matchKeywords, compileExcludes, isExcluded, applyFilter } from '../scripts/lib/filter.mjs';
import { parseFeed } from '../scripts/lib/parse.mjs';
import { normalizeEntry } from '../scripts/lib/text.mjs';
import { decodeBody } from '../scripts/lib/fetch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// A frozen copy of the launch feeds.json: the tests own their inputs, so editing the real config never breaks them.
const config = JSON.parse(await readFile(path.join(HERE, 'fixtures', 'feeds.json'), 'utf8'));
const matcher = compileKeywords(config.keywords, { wiiU: false });
const excludes = compileExcludes(config.exclude);
const keywordsSource = { id: 'press', name: 'Press', tab: 'press', filter: 'keywords' };
const noneSource = { id: 'scene', name: 'Scene', tab: 'scene', filter: 'none' };

test('the "Wii" token: whole word, case-insensitive, never Wii U', () => {
  const pass = [
    'Nintendo Wii turns 20', "The Wii's best games", 'Wii-era classics', 'wii sports bowling', 'WII', 'My wii.',
    '(Wii)', 'Wii, U and me', 'Wii Universe fan site', 'Buying a Wii in 2026', 'Wii/GameCube adapter', 'Wii: a retrospective',
  ];
  const fail = [
    'Wii U eShop closes', 'WiiU games', 'Wii  U', 'Wii-U', 'Wii U’s backlog', 'Nintendo Switch 2', 'Twii', 'Wiiish',
    'wii u', 'Wii U.', 'Wii u?', 'Wii_U',
  ];
  for (const t of pass) assert.ok(matchKeywords(t, matcher).count >= 1, `should match: ${t}`);
  for (const t of fail) assert.equal(matchKeywords(t, matcher).count, 0, `should not match: ${t}`);
});

test('other keywords: whole phrases with word boundaries, longest first, canonical casing', () => {
  assert.deepEqual(matchKeywords('new wiimote and NUNCHUK', matcher), { count: 2, matched: ['Wiimote', 'Nunchuk'] });
  assert.deepEqual(matchKeywords('wii sports resort', matcher), { count: 1, matched: ['Wii Sports'] }, 'overlap counts once');
  assert.deepEqual(matchKeywords('Wii Sports and Wii Fit', matcher), { count: 2, matched: ['Wii Sports', 'Wii Fit'] });
  assert.deepEqual(matchKeywords('the Wii   Remote Plus', matcher), { count: 1, matched: ['Wii Remote'] });
  assert.deepEqual(matchKeywords('homebrew channel install guide', matcher), { count: 1, matched: ['Homebrew Channel'] });
  assert.deepEqual(matchKeywords('WiiLink and RiiConnect24 and Wiimmfi', matcher), { count: 3, matched: ['Wiimmfi', 'WiiLink', 'RiiConnect24'] });
  assert.equal(matchKeywords('Balance Boarding', matcher).count, 0, 'whole phrase only');
  assert.equal(matchKeywords('WiiWareHouse', matcher).count, 0);
  assert.equal(matchKeywords('Wii Fit U is a Wii U game', matcher).count, 0, 'Wii-prefixed phrases also reject a trailing U');
  assert.deepEqual(matchKeywords('Wii U and Wii games', matcher), { count: 1, matched: ['Wii'] });
  assert.deepEqual(matchKeywords('', matcher), { count: 0, matched: [] });
});

test('wiiU: true accepts Wii U mentions', () => {
  const m = compileKeywords(config.keywords, { wiiU: true });
  assert.deepEqual(matchKeywords('Wii U eShop', m), { count: 1, matched: ['Wii U'] });
  assert.deepEqual(matchKeywords('WiiU', m), { count: 1, matched: ['Wii U'] });
  assert.deepEqual(matchKeywords('Wii Universe', m), { count: 1, matched: ['Wii'] });
  assert.equal(matchKeywords('Wii Fit U', m).count, 1);
});

test('keyword sources: a title match passes, otherwise two body occurrences are needed', () => {
  const rules = { matcher, excludes };
  assert.deepEqual(applyFilter({ title: 'Wii Sports turns 20', text: '' }, keywordsSource, rules), { keep: true, matched: ['Wii Sports'], reason: 'title' });
  assert.equal(applyFilter({ title: 'Nintendo history', text: 'The Wii and the Wiimote changed everything.' }, keywordsSource, rules).reason, 'body');
  assert.deepEqual(applyFilter({ title: 'Nintendo history', text: 'The Wii and the Wiimote.' }, keywordsSource, rules).matched, ['Wii', 'Wiimote']);
  assert.deepEqual(applyFilter({ title: 'Switch 2 news', text: 'Unlike the Wii, it sold well.' }, keywordsSource, rules), { keep: false, matched: ['Wii'], reason: 'no-match' });
  assert.equal(applyFilter({ title: 'Wii U retrospective', text: 'The Wii U and the Wii U GamePad.' }, keywordsSource, rules).keep, false);
});

test('unconditional sources keep everything (matched is empty) except exclusions', () => {
  const rules = { matcher, excludes };
  assert.deepEqual(applyFilter({ title: 'Christmas Lights as sensor bar', text: '' }, noneSource, rules), { keep: true, matched: [], reason: 'unconditional' });
  assert.equal(applyFilter({ title: 'Memery Monday is here. Share your Wii-related memes, today only!' }, noneSource, rules).keep, false);
  assert.equal(applyFilter({ title: 'What are Wii playing Wednesday? (Nov 04, 2026)' }, noneSource, rules).keep, false);
  assert.equal(applyFilter({ title: 'Wii Homebrew MEGATHREAD 2026' }, keywordsSource, rules).reason, 'excluded');
  assert.equal(applyFilter({ title: 'Weekly Help Thread' }, noneSource, rules).keep, false);
});

test('exclude patterns are case-insensitive regex sources; invalid ones are reported and skipped', () => {
  const errors = [];
  const ex = compileExcludes(['^daily', '(unclosed', 'thread$'], (p) => errors.push(p));
  assert.equal(ex.length, 2);
  assert.deepEqual(errors, ['(unclosed']);
  assert.ok(isExcluded('DAILY discussion', ex));
  assert.ok(isExcluded('Weekly THREAD', ex));
  assert.ok(!isExcluded('A thread about the Wii', ex));
});

test('real Google News fixture: Wii U and non-Wii headlines are dropped', async () => {
  const src = config.sources.find((s) => s.id === 'googlenews');
  const feed = parseFeed(decodeBody(await readFile(path.join(HERE, 'fixtures', 'googlenews.xml'))).text);
  const verdicts = feed.items.map((raw) => {
    const n = normalizeEntry(raw, src);
    return { title: n.title, ...applyFilter({ title: n.title, text: n.text }, src, { matcher, excludes }) };
  });
  const kept = verdicts.filter((v) => v.keep).map((v) => v.title);
  const dropped = verdicts.filter((v) => !v.keep).map((v) => v.title);
  assert.ok(kept.includes('5 Classic Nintendo Wii Games That Are Unplayable Today'));
  assert.ok(dropped.some((t) => /misunderstood Wii U/.test(t)), 'Wii U story dropped');
  assert.ok(dropped.some((t) => /Switch Sports Resort/.test(t)), 'no Wii in the title, description only repeats it');
  for (const v of verdicts.filter((x) => x.keep)) assert.deepEqual(v.matched.includes('Wii') || v.matched.length > 0, true);
});

test('real outlet fixtures: today none of the latest items is about the Wii', async () => {
  for (const id of ['nintendolife', 'gonintendo', 'nintendoeverything', 'timeextension']) {
    const src = config.sources.find((s) => s.id === id);
    const feed = parseFeed(decodeBody(await readFile(path.join(HERE, 'fixtures', `${id}.xml`))).text);
    const kept = feed.items.map((raw) => normalizeEntry(raw, src)).filter((n) => applyFilter({ title: n.title, text: n.text }, src, { matcher, excludes }).keep);
    assert.deepEqual(kept.map((n) => n.title), [], id);
  }
});

test('Hackaday uses the keyword filter: tangential posts in its wii tag are dropped', async () => {
  const src = config.sources.find((s) => s.id === 'hackaday');
  assert.equal(src.filter, 'keywords');
  const feed = parseFeed(decodeBody(await readFile(path.join(HERE, 'fixtures', 'hackaday.xml'))).text);
  const verdicts = feed.items.map((raw) => {
    const n = normalizeEntry(raw, src);
    return [n.title, applyFilter({ title: n.title, text: n.text }, src, { matcher, excludes })];
  });
  const dropped = verdicts.filter(([, v]) => !v.keep).map(([t]) => t);
  assert.deepEqual(dropped, ['Converting a 1980s Broadcast Camera to HDMI']);
  const libogc = verdicts.find(([t]) => /RTEMS/.test(t))[1];
  assert.equal(libogc.reason, 'body', 'a Wii story without Wii in the title passes on its body');
});

test('real Reddit fixtures: the recurring AutoModerator threads are excluded, everything else is kept', async () => {
  const excluded = {};
  for (const id of ['reddit-wii', 'reddit-wiihacks']) {
    const src = config.sources.find((s) => s.id === id);
    assert.equal(src.filter, 'none');
    const feed = parseFeed(decodeBody(await readFile(path.join(HERE, 'fixtures', `${id}.xml`))).text);
    excluded[id] = feed.items
      .map((raw) => normalizeEntry(raw, src))
      .filter((n) => !applyFilter({ title: n.title, text: n.text }, src, { matcher, excludes }).keep)
      .map((n) => n.title);
  }
  assert.deepEqual(excluded['reddit-wii'], [
    'What are Wii playing Wednesday? (Nov 04, 2026) Share your Wii Number here!',
    'Memery Monday is here. Share your Wii-related memes, today only!',
  ]);
  assert.deepEqual(excluded['reddit-wiihacks'], [
    "rWiiHacks' Support Megathread (November 2026)",
    'Wii Hacks Wii Modding Help Thread! November 01, 2026',
  ]);
});

test('a compound accessory name is one mention: "Wii Nunchuk" counts once, "Wii and a Nunchuk" twice (engine-v2)', () => {
  assert.deepEqual(matchKeywords('A robot steered by a Wii Nunchuk.', matcher), { count: 1, matched: ['Wii', 'Nunchuk'] });
  assert.equal(matchKeywords('A bathroom scale made from a Wii Balance Board.', matcher).count, 1);
  assert.equal(matchKeywords('Install the Wii Homebrew Channel.', matcher).count, 1);
  assert.equal(matchKeywords('a Wii MotionPlus gyro', matcher).count, 1);
  assert.equal(matchKeywords('a Wii-Nunchuk adapter', matcher).count, 1);
  assert.equal(matchKeywords('the Wii and a Nunchuk', matcher).count, 2);
  assert.equal(matchKeywords('Wii, Nunchuk', matcher).count, 2, 'a comma separates two things');
  const robot = { title: 'Robot arm gets a joystick upgrade', text: 'The arm is now steered with a Wii Nunchuk over I2C.' };
  assert.equal(applyFilter(robot, keywordsSource, { matcher, excludes }).keep, false, 'one passing mention is not Wii news');
});

test('the Wii U rejection covers typographic dashes, "U." at a sentence end and Wii U titles; "U.S." is not U (engine-9)', () => {
  for (const t of ['Wii–U backlog', 'Wii‑U', 'Wii—U', 'Wii‐U', 'Wii Party U review', 'Wii Karaoke U shuts down', 'Wii Street U', 'Wii Sports Club on the GamePad', 'I loved the Wii U.']) {
    assert.equal(matchKeywords(t, matcher).count, 0, `should not match: ${t}`);
  }
  for (const t of ['Nintendo Wii U.S. sales chart', 'Wii Sports bowling', 'Wii Party night', 'Wii Sports clubhouse']) {
    assert.ok(matchKeywords(t, matcher).count >= 1, `should match: ${t}`);
  }
  const m = compileKeywords(config.keywords, { wiiU: true });
  assert.ok(matchKeywords('Wii Party U review', m).count >= 1, 'wiiU: true accepts Wii U titles');
});

test('a WordPress teaser and the full post are one text: a single first-paragraph mention is not counted twice (engine-2)', async () => {
  const { matchText } = await import('../scripts/lib/text.mjs');
  const teaser = '<p>A 1980s broadcast camera gets HDMI. The trick came from a Wii mod chip.</p> [&#8230;]';
  const post = '<p>A 1980s broadcast camera gets HDMI. The trick came from a Wii mod chip.</p><p>The rest of the build.</p>';
  assert.equal(matchText({ description: teaser, content: post }), 'A 1980s broadcast camera gets HDMI. The trick came from a Wii mod chip. The rest of the build.');
  assert.equal(matchKeywords(matchText({ description: teaser, content: post }), matcher).count, 1);
  const camera = { title: 'Converting a 1980s Broadcast Camera to HDMI', text: matchText({ description: teaser, content: post }) };
  assert.equal(applyFilter(camera, { ...keywordsSource, id: 'hackaday' }, { matcher, excludes }).keep, false);
  assert.equal(matchText({ description: 'A summary about the Wii.', content: 'Different body text.' }), 'A summary about the Wii. Different body text.', 'different texts are both read');
  assert.equal(matchText({ description: 'Only a description', content: '' }), 'Only a description');
});
