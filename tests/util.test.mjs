import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  sha256Hex, itemId, stableJSON, isoSeconds, utcDay, toMs, atomicWrite, readJSON, readText, escapeXml, decodeWindows1252, CP1252_80_9F,
} from '../scripts/lib/util.mjs';

test('sha256Hex matches the standard test vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('itemId is the first 12 hex chars of sha256(url)', () => {
  const url = 'https://www.nintendolife.com/news/2026/11/example';
  assert.equal(itemId(url), sha256Hex(url).slice(0, 12));
  assert.match(itemId(url), /^[0-9a-f]{12}$/);
});

test('stableJSON sorts keys at every level and keeps array order', () => {
  const a = stableJSON({ b: 1, a: { d: [3, 2, { z: 1, y: 2 }], c: null } });
  const b = stableJSON({ a: { c: null, d: [3, 2, { y: 2, z: 1 }] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":null,"d":[3,2,{"y":2,"z":1}]},"b":1}');
  assert.equal(stableJSON({ a: undefined, b: 2 }), '{"b":2}');
  assert.equal(stableJSON([undefined, 1]), '[null,1]');
});

test('isoSeconds gives second precision with a Z suffix', () => {
  assert.equal(isoSeconds(new Date('2026-11-04T16:17:00.987Z')), '2026-11-04T16:17:00Z');
  assert.equal(isoSeconds(Date.UTC(2026, 10, 4, 16, 17, 5)), '2026-11-04T16:17:05Z');
  assert.equal(isoSeconds('2026-11-04T11:17:00-05:00'), '2026-11-04T16:17:00Z');
  assert.equal(isoSeconds('nonsense'), null);
  assert.equal(utcDay('2026-11-04T23:59:59Z'), '2026-11-04');
  assert.ok(Number.isNaN(toMs('')));
  assert.equal(toMs('2026-11-04T16:17:00Z'), Date.UTC(2026, 10, 4, 16, 17));
});

test('atomicWrite writes, overwrites, creates directories and leaves no temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-util-'));
  try {
    const file = path.join(dir, 'nested', 'deeper', 'out.json');
    await atomicWrite(file, 'one');
    assert.equal(await readFile(file, 'utf8'), 'one');
    await atomicWrite(file, 'two');
    assert.equal(await readFile(file, 'utf8'), 'two');
    assert.deepEqual(await readdir(path.dirname(file)), ['out.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSON and readText fall back for missing or broken files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wv-util-'));
  try {
    assert.equal(await readJSON(path.join(dir, 'missing.json'), 'fallback'), 'fallback');
    await writeFile(path.join(dir, 'bad.json'), '{ not json');
    assert.equal(await readJSON(path.join(dir, 'bad.json'), null), null);
    await writeFile(path.join(dir, 'bom.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]));
    assert.deepEqual(await readJSON(path.join(dir, 'bom.json')), { a: 1 });
    assert.equal(await readText(path.join(dir, 'missing.txt')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('escapeXml escapes markup and removes characters XML cannot carry', () => {
  assert.equal(escapeXml(`<a href="x">'Tom' & "Jerry"</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;Tom&#39; &amp; &quot;Jerry&quot;&lt;/a&gt;');
  assert.equal(escapeXml(`ok${String.fromCharCode(0, 7, 0x1f)}ok`), 'okok');
  assert.equal(escapeXml(`tab\tnew\nline`), 'tab\tnew\nline');
  assert.equal(escapeXml(`lone ${String.fromCharCode(0xd800)} surrogate`), 'lone  surrogate');
  assert.equal(escapeXml('emoji 😀 stays'), 'emoji 😀 stays');
  assert.equal(escapeXml(null), '');
});

test('decodeWindows1252 maps the 0x80-0x9F range', () => {
  assert.equal(CP1252_80_9F.length, 32);
  assert.equal(decodeWindows1252(Buffer.from([0x92, 0x93, 0x94, 0x96, 0x97, 0x80, 0xe9, 0x41])), '’“”–—€éA');
});
