#!/usr/bin/env node
// Offline preview build (npm run build:offline): copies site/ and state/state.json to work/offline/
// (git-ignored) and runs the builder there from the saved feeds in tests/fixtures/. The tracked site/ and
// state/ stay exactly as the bot committed them, so a preview can never end up in a commit or cause a
// merge conflict with the bot's next commit.
//
//   node tools/offline.mjs [more build-news.mjs flags, for example --now 2026-11-19T15:00:00Z]
//   npm run build:offline && npm run serve:offline      # then open http://127.0.0.1:8788
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/build-news.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'work', 'offline');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(path.join(ROOT, 'site'), path.join(OUT, 'site'), { recursive: true });
const state = path.join(ROOT, 'state', 'state.json');
if (existsSync(state)) await cp(state, path.join(OUT, 'state.json'));
process.exitCode = await main(['--offline', '--force', '--out', path.join(OUT, 'site'), '--state', path.join(OUT, 'state.json'), ...process.argv.slice(2)]);
if (!process.exitCode) console.log(`Preview written to ${path.relative(process.cwd(), OUT)}/site; serve it with: npm run serve:offline`);
