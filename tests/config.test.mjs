// The real configuration: feeds.json, the page template and site/archive.json. These tests check only
// invariants (valid types, a build that runs), never ids, names or counts, so the owner can add, remove or
// retune sources as README and RUNBOOK describe without touching a test. Everything else in tests/ runs
// against frozen copies in tests/fixtures/ (feeds.json and the saved feeds).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, validateTemplate, parseArchive, runBuild } from '../scripts/build-news.mjs';
import { parseJsonLoose } from '../scripts/lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const real = parseJsonLoose(await readFile(path.join(ROOT, 'feeds.json'), 'utf8'));

const temps = [];
after(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

test('the real feeds.json is valid', () => {
  assert.doesNotThrow(() => validateConfig(structuredClone(real)));
});

test('the real feeds.json, template and archive build offline (invariants only)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-config-'));
  temps.push(dir);
  const out = path.join(dir, 'site');
  await mkdir(out, { recursive: true });
  await copyFile(path.join(ROOT, 'site', 'archive.json'), path.join(out, 'archive.json'));
  const r = await runBuild({
    offline: true, quiet: true, env: {},
    fixtures: path.join(HERE, 'fixtures'), out, state: path.join(dir, 'state.json'),
    config: path.join(ROOT, 'feeds.json'), template: path.join(ROOT, 'templates', 'index.html'),
    now: '2026-11-04T17:00:00Z',
  });
  assert.equal(r.changed, true);
  assert.equal(r.health.sources.length, real.sources.length, 'one health row per configured source');
  const ids = new Set(real.sources.map((s) => s.id));
  for (const it of r.news.items) assert.ok(ids.has(it.sourceId), `${it.sourceId} is configured`);
  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  for (const it of r.news.items) assert.ok(html.includes(`data-id="${it.id}"`), it.id);
  assert.ok(html.length > 10000, 'a real page, not an empty template');
});

test('wrong types in feeds.json fail the build instead of emptying the page (engine-12)', () => {
  const bad = (edit) => {
    const c = structuredClone(real);
    edit(c);
    return () => validateConfig(c);
  };
  assert.throws(bad((c) => (c.exclude = 'megathread')), /exclude must be a list/);
  assert.throws(bad((c) => (c.keywords = 'Wii')), /keywords must be a list/);
  assert.throws(bad((c) => (c.sources[0].strip = 'Read more')), /strip must be a list/);
  assert.throws(bad((c) => (c.sources[0].maxItems = 0)), /maxItems/);
  assert.throws(bad((c) => (c.selection.maxPerSource = 0)), /maxPerSource/);
  assert.throws(bad((c) => (c.selection.minItems = c.selection.maxItems + 1)), /minItems/);
  assert.throws(bad((c) => (c.selection.minPerTab = 'eight')), /minPerTab must be a whole number/);
  assert.throws(bad((c) => (c.selection.minPerSource = -1)), /minPerSource must be a whole number/);
  assert.doesNotThrow(bad((c) => (delete c.selection.minPerSource, delete c.selection.minPerTab)), 'the floors are optional (0)');
  assert.throws(bad((c) => (c.wiiU = 'yes')), /wiiU/);
  assert.throws(bad((c) => (c.sources[0].userAgent = '')), /userAgent/);
});

test('the workflow pins Node 26 in every job, so an LTS switch never happens unattended (D13)', async () => {
  const yml = await readFile(path.join(ROOT, '.github', 'workflows', 'site.yml'), 'utf8');
  const versions = [...yml.matchAll(/^\s+node-version:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(versions, ['26', '26', '26'], 'build, check and verify');
});

test('a comment in feeds.json is allowed, as the annotated example in ARCHITECTURE section 3 suggests', () => {
  const text = '{\n  // annotated\n  "a": ["x", /* y */ "\\\\d{2,}",],\n}';
  assert.deepEqual(parseJsonLoose(text), { a: ['x', '\\d{2,}'] }, 'string contents are never touched');
  assert.throws(() => parseJsonLoose('{"a": }'), SyntaxError);
});

test('a missing or slotless template and a broken archive.json fail the build', async () => {
  assert.throws(() => validateTemplate(null, 'templates/index.html'), /missing or empty/);
  assert.throws(() => validateTemplate('  ', 'templates/index.html'), /missing or empty/);
  assert.throws(() => validateTemplate('<html><!--@status--></html>', 't.html'), /<!--@stream--> slot/);
  const template = await readFile(path.join(ROOT, 'templates', 'index.html'), 'utf8');
  assert.doesNotThrow(() => validateTemplate(template, 't'));
  assert.deepEqual(parseArchive(null).items, [], 'no archive.json at all is allowed');
  assert.throws(() => parseArchive('{"items": [', 'site/archive.json'), /not valid JSON/);
  assert.throws(() => parseArchive('{"items": []}', 'site/archive.json'), /has no items/);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-config-'));
  temps.push(dir);
  await assert.rejects(
    runBuild({ offline: true, quiet: true, env: {}, fixtures: path.join(HERE, 'fixtures'), out: path.join(dir, 'site'), state: path.join(dir, 'state.json'), config: path.join(ROOT, 'feeds.json'), template: path.join(dir, 'missing.html'), now: '2026-11-04T17:00:00Z' }),
    /template missing/,
  );
});
