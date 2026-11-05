#!/usr/bin/env node
// Renders the share image and the PNG icons from the HTML sources in this folder, with tools/shoot.mjs
// (headless Chrome), copies favicon.svg and builds favicon.ico from it. Dev only: run it after changing the
// console in site/style.css or the favicon.
//
//   node assets-src/render.mjs             everything below, then shrink the PNGs
//   node assets-src/render.mjs --favicon   only site/favicon.svg and site/favicon.ico
//   node assets-src/render.mjs --shrink    only shrink the PNGs already in site/
//
// Writes site/og.png (1200x630), site/icon-512.png, site/icon-192.png, site/apple-touch-icon.png (180x180),
// site/icon-maskable-512.png (console inside the 80% safe circle), site/favicon.svg and site/favicon.ico
// (16 and 32 px PNGs in one ICO, for feed readers and tools that ask for /favicon.ico).
// The pages are served next to a copy of site/, so they use the real style.css, fonts and CSP.
//
// Shrinking: when ffmpeg is installed, each PNG is re-encoded as an 8-bit palette PNG (no visible change at
// 1x, about half the bytes) and kept only if smaller. Without ffmpeg this step is skipped with a note; nothing
// else in the project needs ffmpeg.

import { cp, mkdtemp, rm, mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.mjs';
import { shootAll } from '../tools/shoot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..', 'site');
const PNGS = ['og.png', 'icon-512.png', 'icon-192.png', 'apple-touch-icon.png', 'icon-maskable-512.png'];
const args = new Set(process.argv.slice(2));
const all = !args.has('--favicon') && !args.has('--shrink');

/** An ICO file holding PNG images (supported by every current browser and by Windows since Vista). */
export function pngsToIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

function report(reports) {
  for (const r of reports) {
    const issues = [r.toolError, ...(r.errors || []), ...(r.csp || []), ...(r.failedRequests || [])].filter(Boolean);
    console.log(`${path.relative(process.cwd(), r.out)}${issues.length ? `  ISSUES: ${issues.join('; ')}` : ''}`);
    if (issues.length) process.exitCode = 1;
  }
}

async function shrink(files) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.log('ffmpeg not found: the PNGs are left as rendered (optional step).');
    return;
  }
  for (const f of files) {
    const file = path.join(SITE, f);
    const tmp = `${file}.pal8.png`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'split[a][b];[a]palettegen=max_colors=256:reserve_transparent=0:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', '-pix_fmt', 'pal8', tmp]);
    const [before, after] = [(await stat(file)).size, (await stat(tmp)).size];
    if (after < before) await rename(tmp, file);
    else await rm(tmp);
    console.log(`${path.relative(process.cwd(), file)}: ${before} -> ${Math.min(before, after)} bytes`);
  }
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'wiivolve-assets-'));
try {
  if (all || args.has('--favicon')) await cp(path.join(HERE, 'favicon.svg'), path.join(SITE, 'favicon.svg'));
  if (!args.has('--shrink')) {
    await cp(SITE, tmp, { recursive: true });
    await mkdir(path.join(tmp, 'assets-src'), { recursive: true });
    for (const f of ['art.css', 'og.html', 'icon.html', 'icon-maskable.html']) await cp(path.join(HERE, f), path.join(tmp, 'assets-src', f));
    // The favicon on a transparent page, at 16 and 32 px.
    await writeFile(path.join(tmp, 'assets-src', 'favicon.html'), '<!doctype html><html><head><meta charset="utf-8"><title>favicon</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/assets-src/art.css"></head><body class="fav"><img src="/favicon.svg" alt=""></body></html>');
    const server = await startServer({ dir: tmp, port: 0 });
    const page = (name) => `${server.url}/assets-src/${name}`;
    const base = { reducedMotion: true, wait: 300 };
    const shots = [];
    if (all) {
      shots.push(
        { ...base, url: page('og.html'), out: path.join(SITE, 'og.png'), width: 1200, height: 630 },
        { ...base, url: page('icon.html'), out: path.join(SITE, 'icon-512.png'), width: 512, height: 512 },
        { ...base, url: page('icon.html'), out: path.join(SITE, 'icon-192.png'), width: 512, height: 512, scale: 192 / 512 },
        { ...base, url: page('icon.html'), out: path.join(SITE, 'apple-touch-icon.png'), width: 512, height: 512, scale: 180 / 512 },
        { ...base, url: page('icon-maskable.html'), out: path.join(SITE, 'icon-maskable-512.png'), width: 512, height: 512 },
      );
    }
    const icoParts = [16, 32].map((size) => ({ size, out: path.join(tmp, `favicon-${size}.png`) }));
    for (const { size, out } of icoParts) shots.push({ ...base, url: page('favicon.html'), out, width: 32, height: 32, scale: size / 32, transparent: true });
    try {
      report(await shootAll(shots));
    } finally {
      await server.close();
    }
    const images = await Promise.all(icoParts.map(async ({ size, out }) => ({ size, png: await readFile(out) })));
    await writeFile(path.join(SITE, 'favicon.ico'), pngsToIco(images));
    console.log('site/favicon.ico (16 and 32 px)');
  }
  if (all || args.has('--shrink')) await shrink(PNGS);
  try {
    for (const f of PNGS) console.log(execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(SITE, f)], { encoding: 'utf8' }).trim().replace(/\n\s+/g, '  '));
  } catch {
    // sips is macOS only; the sizes are fixed by the shots above.
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
