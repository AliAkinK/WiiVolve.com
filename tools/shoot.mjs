#!/usr/bin/env node
// Zero-dependency screenshots through the Chrome DevTools Protocol (Node >= 22 has a global WebSocket).
//
// Single shot:
//   node tools/shoot.mjs <url> <out.png> [--width 1440] [--height 900] [--scale 1] [--full] [--max-height 12000]
//        [--dark] [--mobile] [--reduced-motion] [--forced-colors] [--print] [--nojs] [--transparent] [--wait 600]
//        [--scroll <css selector>] [--eval <js run after load>] [--storage '{"key":"value"}']
//        [--stub web.archive.org] [--setup <js>] [--keys Tab,Tab,Enter]
//   --stub HOST answers every request to HOST with a small stub page instead of the network, and lists
//   the URLs in the report (stubbed), so a redirect to the Wayback Machine can be checked offline.
//   --setup runs before --keys (real key presses through DevTools), --eval after them.
// Batch (one Chrome for all shots):
//   node tools/shoot.mjs --spec shots.json        # JSON array of { url, out, width, height, ...same options }
//
// Prints a JSON report: [{ out, url, errors, consoleErrors, csp, failedRequests, stubbed, cls, lcp, scrollHeight }]
// Uses CHROME_PATH if set, else the standard macOS / Linux Chrome locations.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function chromePath() {
  const list = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = list.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUB_PAGE = Buffer.from('<!doctype html><meta charset="utf-8"><title>Stub</title><p>Stub page (tools/shoot.mjs --stub)</p>').toString('base64');
const KEY_CODES = { Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, '/': 191 };
const KEY_TEXT = { Enter: '\r' };

async function launch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiivolve-shoot-'));
  const proc = spawn(
    chromePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--disable-gpu',
      '--mute-audio',
      '--disable-extensions',
      '--disable-background-networking',
      '--password-store=basic',
      '--use-mock-keychain',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not start');
  const [port, wsPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const close = async () => {
    try {
      await send('Browser.close');
    } catch {}
    ws.close();
    proc.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  return { send, listeners, close };
}

// CLS, its sources (what moved, from where to where) and LCP, read from the page after the shot.
const OBSERVER = `(() => {
  window.__shoot = { cls: 0, lcp: 0, shifts: [] };
  const name = (n) => (n ? n.id || String(n.className || n.nodeName).slice(0, 40) : '?');
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__shoot.cls += e.value;
        window.__shoot.shifts.push(\`\${Math.round(e.startTime)}ms \${e.value.toFixed(3)}: \` + e.sources.map((s) => \`\${name(s.node)} y\${Math.round(s.previousRect.y)}->\${Math.round(s.currentRect.y)}\`).join(', '));
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shoot.lcp = Math.round(e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
})();`;

async function shoot(browser, shot) {
  const { send, listeners } = browser;
  const o = {
    width: shot.mobile ? 390 : 1440,
    height: shot.mobile ? 844 : 900,
    scale: 1,
    wait: 600,
    maxHeight: 12000,
    ...shot,
  };
  // Each shot gets its own browser context, so storage and cookies never leak from one shot to the next.
  const { browserContextId } = await send('Target.createBrowserContext', {});
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const report = { out: o.out, url: o.url, errors: [], consoleErrors: [], csp: [], failedRequests: [], stubbed: [] };
  let loaded = null;
  const onEvent = (msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params || {};
    if (msg.method === 'Page.loadEventFired' && loaded) loaded();
    if (msg.method === 'Fetch.requestPaused') {
      report.stubbed.push(p.request.url);
      const headers = [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }];
      s('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: STUB_PAGE }).catch(() => {});
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails || {};
      report.errors.push((d.exception && d.exception.description) || d.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning' || p.type === 'assert')) {
      report.consoleErrors.push(`${p.type}: ${(p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = p.entry || {};
      const text = `${e.level}: ${e.text}${e.url ? ` (${e.url})` : ''}`;
      if (/content security policy/i.test(e.text || '')) report.csp.push(text);
      else if (e.level === 'error' && !(e.url && e.url === o.url && /status of 404/.test(e.text || ''))) report.consoleErrors.push(text);
    }
    if (msg.method === 'Network.responseReceived' && p.response && p.response.status >= 400) {
      const isMainDoc = p.type === 'Document';
      if (!isMainDoc) report.failedRequests.push(`${p.response.status} ${p.response.url}`);
    }
    if (msg.method === 'Network.loadingFailed' && !p.canceled) {
      report.failedRequests.push(`failed ${p.errorText} (${p.type})`);
    }
  };
  listeners.add(onEvent);
  try {
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Log.enable');
    await s('Network.enable');
    await s('Network.setCacheDisabled', { cacheDisabled: true });
    await s('Emulation.setDeviceMetricsOverride', {
      width: o.width,
      height: o.height,
      deviceScaleFactor: o.scale,
      mobile: !!o.mobile,
    });
    if (o.mobile) {
      await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await s('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });
    }
    await s('Emulation.setEmulatedMedia', {
      media: o.print ? 'print' : '',
      features: [
        { name: 'prefers-color-scheme', value: o.dark ? 'dark' : 'light' },
        { name: 'prefers-reduced-motion', value: o.reducedMotion ? 'reduce' : 'no-preference' },
        { name: 'forced-colors', value: o.forcedColors ? 'active' : 'none' },
      ],
    });
    if (o.transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    if (o.nojs) await s('Emulation.setScriptExecutionDisabled', { value: true });
    if (o.stub?.length) await s('Fetch.enable', { patterns: [].concat(o.stub).map((h) => ({ urlPattern: `*://${h}/*`, requestStage: 'Request' })) });
    let source = OBSERVER;
    if (o.storage) {
      source += `\ntry { const s = ${JSON.stringify(o.storage)}; for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {}`;
    }
    await s('Page.addScriptToEvaluateOnNewDocument', { source });
    const loadedPromise = new Promise((r) => (loaded = r));
    await s('Page.navigate', { url: o.url });
    await Promise.race([loadedPromise, sleep(20000)]);
    if (!o.nojs) {
      await s('Runtime.evaluate', {
        expression: 'document.fonts ? document.fonts.ready.then(() => true) : true',
        awaitPromise: true,
      }).catch(() => {});
    }
    await sleep(o.wait);
    if (o.setup) {
      const r = await s('Runtime.evaluate', { expression: o.setup, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) report.errors.push(`setup: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      await sleep(200);
    }
    for (const combo of o.keys || []) {
      const parts = combo.split('+');
      const key = parts.pop();
      const modifiers = parts.reduce((m, k) => m | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[k] || 0), 0);
      const code = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);
      const base = { key, modifiers, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      const text = KEY_TEXT[key] ?? (key.length === 1 ? key : undefined);
      await s('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(80);
    }
    if (o.eval) {
      const r = await s('Runtime.evaluate', { expression: o.eval, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) report.errors.push(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      else if (r.result && r.result.value !== undefined) report.evalResult = r.result.value;
      await sleep(400);
    }
    if (o.scroll) {
      // Works with JS disabled too: Runtime.evaluate runs in DevTools' context regardless of page script state.
      await s('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(o.scroll)}); if (el) { el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true } return false })()`,
      });
      await sleep(500);
    }
    const metrics = await s('Runtime.evaluate', {
      expression: 'JSON.stringify({ cls: window.__shoot ? window.__shoot.cls : null, shifts: window.__shoot ? window.__shoot.shifts : [], lcp: window.__shoot ? window.__shoot.lcp : null, h: document.documentElement.scrollHeight })',
      returnByValue: true,
    }).catch(() => null);
    if (metrics && metrics.result && metrics.result.value) {
      const m = JSON.parse(metrics.result.value);
      report.cls = m.cls == null ? null : Math.round(m.cls * 1000) / 1000;
      if (m.shifts?.length) report.shifts = m.shifts;
      report.lcp = m.lcp;
      report.scrollHeight = m.h;
    }
    let shotParams = { format: 'png' };
    if (o.full) {
      const lm = await s('Page.getLayoutMetrics');
      const h = Math.min(o.maxHeight, Math.ceil((lm.cssContentSize || lm.contentSize).height));
      shotParams = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: o.width, height: h, scale: 1 } };
    }
    const { data } = await s('Page.captureScreenshot', shotParams);
    if (o.out) {
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, Buffer.from(data, 'base64'));
    }
  } finally {
    listeners.delete(onEvent);
    await send('Target.closeTarget', { targetId }).catch(() => {});
    await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  return report;
}

export async function shootAll(shots) {
  const browser = await launch();
  const reports = [];
  try {
    for (const shot of shots) {
      try {
        reports.push(await shoot(browser, shot));
      } catch (err) {
        reports.push({ out: shot.out, url: shot.url, toolError: String(err?.message || err) });
      }
    }
  } finally {
    await browser.close();
  }
  return reports;
}

function parseCli(argv) {
  const shot = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--width': shot.width = Number(next()); break;
      case '--height': shot.height = Number(next()); break;
      case '--scale': shot.scale = Number(next()); break;
      case '--max-height': shot.maxHeight = Number(next()); break;
      case '--wait': shot.wait = Number(next()); break;
      case '--scroll': shot.scroll = next(); break;
      case '--eval': shot.eval = next(); break;
      case '--storage': shot.storage = JSON.parse(next()); break;
      case '--full': shot.full = true; break;
      case '--dark': shot.dark = true; break;
      case '--mobile': shot.mobile = true; break;
      case '--reduced-motion': shot.reducedMotion = true; break;
      case '--forced-colors': shot.forcedColors = true; break;
      case '--transparent': shot.transparent = true; break;
      case '--print': shot.print = true; break;
      case '--nojs': shot.nojs = true; break;
      case '--stub': shot.stub = next().split(','); break;
      case '--setup': shot.setup = next(); break;
      case '--keys': shot.keys = next().split(','); break;
      default: pos.push(a);
    }
  }
  [shot.url, shot.out] = pos;
  return shot;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  let shots;
  if (argv[0] === '--spec') shots = JSON.parse(await readFile(argv[1], 'utf8'));
  else shots = [parseCli(argv)];
  if (!shots.length || !shots[0].url) {
    console.error('Usage: node tools/shoot.mjs <url> <out.png> [options] | --spec shots.json');
    process.exit(2);
  }
  const reports = await shootAll(shots);
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((r) => r.toolError)) process.exit(1);
}
