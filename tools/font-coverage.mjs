#!/usr/bin/env node
// The characters a WOFF2 font draws, from its cmap, as the compact hex ranges scripts/lib/render.mjs keeps in
// DISPLAY_COVERAGE (docs/ARCHITECTURE.md section 6.2.3). Zero dependencies: the WOFF2 table data is one Brotli
// stream (node:zlib), and cmap is never transformed, so it is read as it is.
//
//   node tools/font-coverage.mjs [site/fonts/bricolage-grotesque-96.woff2]
//
// Run it after changing the font file and paste the line it prints into DISPLAY_COVERAGE.

import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The WOFF2 known-table tags, by their 6-bit index in the table directory (index 63: the tag follows).
const TAGS = ('cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT ' +
  'VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc ' +
  'feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill').split(' ').map((t) => t.replace('_', ' '));

/** The raw cmap table of a WOFF2 font (a Buffer). Throws on anything that is not a single-font WOFF2. */
export function woff2Cmap(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 font');
  if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('font collections are not supported');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let o = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[o++];
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[o++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString('latin1', o, o + 4);
      o += 4;
    }
    const version = flags >> 6;
    const orig = base128();
    // glyf and loca are transformed at version 0, hmtx at version 1; then a transformLength follows.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : tag === 'hmtx' ? version === 1 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(o, o + compressed));
  let at = 0;
  for (const t of tables) {
    if (t.tag === 'cmap') return data.subarray(at, at + t.length);
    at += t.length;
  }
  throw new Error('no cmap table');
}

/** Code points mapped to a glyph by a cmap table: the Unicode subtable, format 12 or 4. */
export function cmapCodePoints(cmap) {
  const records = [];
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    records.push({ platform: cmap.readUInt16BE(4 + i * 8), encoding: cmap.readUInt16BE(6 + i * 8), offset: cmap.readUInt32BE(8 + i * 8) });
  }
  const pick = (p, e) => records.find((r) => r.platform === p && r.encoding === e);
  const rec = pick(3, 10) ?? pick(0, 4) ?? pick(0, 6) ?? pick(3, 1) ?? pick(0, 3) ?? records.find((r) => r.platform === 0);
  if (!rec) throw new Error('no Unicode cmap subtable');
  const s = cmap.subarray(rec.offset);
  const out = new Set();
  const format = s.readUInt16BE(0);
  if (format === 12) {
    for (let i = 0; i < s.readUInt32BE(12); i++) {
      const start = s.readUInt32BE(16 + i * 12);
      const end = s.readUInt32BE(20 + i * 12);
      const glyph = s.readUInt32BE(24 + i * 12);
      for (let c = start; c <= end; c++) if (glyph + (c - start)) out.add(c);
    }
  } else if (format === 4) {
    const segX2 = s.readUInt16BE(6);
    const ends = 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = s.readUInt16BE(ends + i * 2);
      const start = s.readUInt16BE(starts + i * 2);
      const delta = s.readInt16BE(deltas + i * 2);
      const range = s.readUInt16BE(ranges + i * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g = range ? s.readUInt16BE(ranges + i * 2 + range + (c - start) * 2) : c;
        if (g) g = (g + delta) & 0xffff;
        if (g) out.add(c);
      }
    }
  } else throw new Error(`cmap format ${format} is not supported`);
  return out;
}

/** A set of code points as sorted hex ranges: "20-7e a0-a3 131". */
export function toRanges(codePoints) {
  const list = [...codePoints].sort((a, b) => a - b);
  const ranges = [];
  for (const c of list) {
    const r = ranges.at(-1);
    if (r && r[1] === c - 1) r[1] = c;
    else ranges.push([c, c]);
  }
  return ranges.map(([a, b]) => (a === b ? a.toString(16) : `${a.toString(16)}-${b.toString(16)}`)).join(' ');
}

/** The DISPLAY_COVERAGE string for a font file. */
export function fontCoverage(file) {
  return toRanges(cmapCodePoints(woff2Cmap(readFileSync(file))));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(fontCoverage(process.argv[2] || path.join(root, 'site', 'fonts', 'bricolage-grotesque-96.woff2')));
}
