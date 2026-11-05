// WiiVolve enhancements (docs/ARCHITECTURE.md 6.2). ?now=<ISO> shifts the clock and never writes storage.
const d = document, root = d.documentElement, W = window, DAY = 864e5, cl = root.classList;
const $ = (s, el = d) => el.querySelector(s), $$ = (s, el = d) => [...el.querySelectorAll(s)];
const MONTHS = 'January February March April May June July August September October November December'.split(' ');
const WD = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
const params = new URLSearchParams(location.search);
const forced = Date.parse(params.get('now')), testing = forced === forced, skew = testing ? forced - Date.now() : 0;
const now = () => new Date(Date.now() + skew);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const store = (area, key, value) => {
  try { const s = W[`${area}Storage`]; key = `wiivolve:${key}`; return value === undefined ? s.getItem(key) : testing || s.setItem(key, value); } catch { return null; }
};
const localDay = (t) => { const x = new Date(t); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / DAY; };
const short = (x) => `${MONTHS[x.getMonth()].slice(0, 3)} ${x.getDate()}`;
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").toLowerCase();
const mk = (tag, cls, text, props) => { const e = d.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return Object.assign(e, props); };
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const say = (msg) => { $('#live').textContent = msg; };

cl.add('js');
if (!performance.getEntriesByType('paint').length) { cl.add('boot'); setTimeout(() => cl.remove('boot'), 1200); }

const stream = $('#stream'), input = $('#search'), fresh = $('#fresh'), cap = $('#cap');
const items = $$('[data-item]'), live = items.filter((el) => el.dataset.tab !== 'archive');
// Search text: headline, excerpt, source (not the archive's "WiiVolve", which "wii" would always hit).
const hay = new Map(items.map((el) => {
  const source = el.dataset.tab === 'archive' ? '' : el.dataset.source;
  return [el, norm(`${$('.hl', el).textContent} ${$('.ex', el)?.textContent || ''} ${source}`)];
}));
const caption = () => { cap.textContent = cap.dataset[cl.contains('bday') ? 'bday' : cl.contains('lit') ? 'lit' : 'idle']; };

function age(N) {
  const [ly, lm, ld] = $('#age').dataset.launch.split('-').map(Number), y = N.getFullYear();
  const on = (yy) => Date.UTC(yy, lm - 1, ld) / DAY, today = Date.UTC(y, N.getMonth(), N.getDate()) / DAY;
  const n = (v) => `<span class="n">${v}</span>`, s = (v, w) => `${n(v)} ${w}${v === 1 ? '' : 's'}`;
  if (today === on(y)) return [`Happy birthday,\u00a0Wii. ${n(y - ly)} today.`, 1];
  if (today < on(ly + 20)) return [`${n(20)} years in ${s(on(ly + 20) - today, 'day')}.`];
  const yrs = y - ly - (today < on(y));
  return [`${s(yrs, 'year')} and ${s(today - on(ly + yrs), 'day')} old.`];
}

{
  const N = now(), last = store('local', 'lastVisit'), kept = store('session', 'prevVisit');
  const prev = Date.parse(kept ?? last) > 0 ? kept ?? last : new Date(N - DAY).toISOString();
  const first = kept ? store('session', 'first') === '1' : !last;
  store('session', 'prevVisit', prev);
  if (first) store('session', 'first', '1');
  store('local', 'lastVisit', N.toISOString());
  const news = live.filter((el) => Date.parse(el.dataset.firstSeen) > Date.parse(prev));
  for (const el of news) { el.classList.add('new'); $('.mt', el).prepend(mk('span', 'tag', 'New')); }
  if (news.length) { cl.add('lit'); fresh.textContent = `${news.length} new ${first ? 'in the last 24 hours' : 'since your last visit'}`; }
}

// Regroup by local date; a story older than the window starts its own group.
const mark = $('.further', stream), ws = Date.parse(stream.dataset.window);
function groupOf(t, N) {
  const x = new Date(t), y = x.getFullYear(), m = x.getMonth(), diff = localDay(N) - localDay(t), o = t < ws;
  if (diff > 45) return [y, `${y}-${m}${o}`, `${MONTHS[m]} ${y}`];
  return [y, `${y}-${m}-${x.getDate()}${o}`, diff < 1 ? 'Today' : diff < 2 ? 'Yesterday' : diff < 7 ? WD[x.getDay()] : short(x)];
}
function regroup(N) {
  const frag = d.createDocumentFragment();
  let y0, k0, body, ul;
  for (const el of live) {
    const [y, k, label] = groupOf(Date.parse(el.dataset.published), N);
    if (y !== y0) frag.appendChild(mk('section', 'yr')).append(mk('h2', 'yr-h', (y0 = y)), (body = mk('div', 'yr-b')));
    if (k !== k0) body.appendChild(mk('section', 'grp')).append(mk('h3', 'grp-h', label), (ul = mk('ul', 'its'))), (k0 = k);
    ul.append(el);
  }
  if (live.length) stream.replaceChildren(frag);
}
// Quiet phrases the renderer found true for this view (none in a search); "Further back" before the first
// visible story older than the window (6.2.3).
function views() {
  const k = root.dataset.tab === 'all' ? 'qa' : 'qt';
  for (const g of $$('.grp', stream)) {
    const q = !cl.contains('searching') && $$('.it', g).find((el) => el.offsetParent)?.dataset[k];
    $('.quiet', g)?.remove();
    if (q) g.prepend(mk('p', 'quiet', q));
    g.classList.toggle('gap', !!q);
  }
  const old = live.find((el) => el.offsetParent && Date.parse(el.dataset.published) < ws)?.closest('.grp');
  if (old) old.prepend(mark), old.classList.add('gap');
}

const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
function rel(t, N) {
  const s = (N - t) / 1e3, x = new Date(t), diff = localDay(N) - localDay(t);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  // The same local day (25 h long when clocks go back) is never "Yesterday".
  if (s < 86400 || diff < 1) return `${Math.floor(s / 3600)}h ago`;
  if (diff < 2) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return short(x) + (x.getFullYear() === N.getFullYear() ? '' : `, ${x.getFullYear()}`);
}
let builtFor;
function tick() {
  const N = now();
  if (localDay(N) !== builtFor) {
    builtFor = localDay(N);
    regroup(N);
    if (root.dataset.tab) views();
    const [html, bday] = age(N);
    $('#age').innerHTML = html;
    cl.toggle('bday', !!bday);
    if (bday && !$('#party')) d.head.append(mk('link', '', null, { rel: 'stylesheet', href: '/party.css', id: 'party' }));
    caption();
  }
  for (const el of live) { const t = $('time', el), ms = Date.parse(t.dateTime); t.textContent = rel(ms, N); t.title = full.format(ms); }
  const g = Date.parse($('#status').dataset.generated), r = g && rel(g, N);
  if (r) $('#upd').textContent = `Updated ${/^[JY]/.test(r) ? r.toLowerCase() : r}`;
}
tick();
setInterval(() => d.hidden || tick(), 6e4);
d.addEventListener('visibilitychange', () => d.hidden || tick());
addEventListener('pageshow', (e) => e.persisted && tick());

const radios = $$('input[name="tab"]'), wanted = radios.find((r) => r.value === params.get('tab'));
if (wanted) wanted.checked = true;
root.dataset.tab = radios.find((r) => r.checked).value;
// ?tab= filters after the first frame: the stream keeps the first screen until the reader filters, so a short
// tab never pulls the deep end into view (a layout shift).
if (root.dataset.tab !== 'all') stream.style.minHeight = `${innerHeight - stream.getBoundingClientRect().top}px`;
input.value = params.get('q') || '';
// A transition skipped by a newer one is not an error.
const transition = (update) => {
  if (!d.startViewTransition || reduce.matches) return update();
  d.startViewTransition(update).ready.catch(() => {});
};
function highlight(terms) {
  if (!W.Highlight) return;
  const ranges = [];
  if (terms.length) for (const el of $$('.it:not(.off) :is(.hl,.ex,.mt b)')) {
    const node = el.firstChild, t = node?.data || '', n = norm(t), flat = n.length === t.length ? n : t.toLowerCase();
    for (const term of terms) for (let i = flat.indexOf(term); i > -1; i = flat.indexOf(term, i + term.length)) {
      const r = new Range();
      r.setStart(node, i);
      r.setEnd(node, Math.min(i + term.length, t.length));
      ranges.push(r);
    }
  }
  CSS.highlights.set('q', new Highlight(...ranges));
}
// apply() replaces #em's children (#reset is kept). announce: 0 silent, 1 now, 2 after a typing pause.
const em = $('#em'), reset = $('#reset');
let sayT, clear;
function apply(announce) {
  const q = input.value.trim(), terms = norm(q).split(/\s+/).filter(Boolean), tab = root.dataset.tab, s = terms.length > 0;
  const c = { all: 0, press: 0, scene: 0, archive: 0 };
  for (const el of items) {
    const hit = terms.every((t) => hay.get(el).includes(t));
    el.classList.toggle('off', !hit);
    if (hit) { c[el.dataset.tab]++; if (el.dataset.tab !== 'archive') c.all++; }
  }
  for (const k of ['all', 'press', 'scene']) $(`#n-${k}`).textContent = c[k];
  const n = c[tab], a = s ? c.archive : 0, u = new URL(location.href), p = u.searchParams;
  $('#empty').hidden = n > 0 || (!s && (tab === 'all' || !live.length));
  // The archive line when no live story matches; "Try All" only if All has one.
  clear = tab === 'all' || !c.all;
  if (a && !c.all) em.replaceChildren(`No news matches. ${count(a, 'headline', 'headlines')} in the archive below.`);
  else if (clear) {
    reset.textContent = 'clear the search';
    em.replaceChildren('No matches. Try a shorter word, or ', reset, '.');
  } else {
    reset.textContent = 'All';
    em.replaceChildren('No matches. Try ', reset, ', or a shorter word.');
  }
  $('#deep-end').hidden = $('.end').hidden = s && !a;
  cl.toggle('searching', s);
  highlight(terms);
  views();
  if (announce) {
    stream.style.minHeight = '';
    const msg = `${count(n, 'story', 'stories')}${a ? `, plus ${a} from the archive` : ''}`;
    clearTimeout(sayT);
    if (announce > 1) sayT = setTimeout(say, 700, msg);
    else say(msg);
    if (!s) toggles();
  }
  q ? p.set('q', q) : p.delete('q');
  tab === 'all' ? p.delete('tab') : p.set('tab', tab);
  if (u.href !== location.href) history.replaceState(history.state, '', u);
}
apply();
for (const r of radios) r.addEventListener('change', () => transition(() => { root.dataset.tab = r.value; apply(1); }));
let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    apply(2);
    const top = ($('#empty').hidden ? stream : $('#empty')).getBoundingClientRect().top - $('.bar').getBoundingClientRect().bottom - 12;
    if (top < 0) scrollBy({ top, behavior: 'instant' });
  }, 140);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(1); } });
// "/" focuses the search unless turned off in the About panel (WCAG 2.1.4).
const slash = $('#slash');
const slashTitle = () => (input.title = slash.checked ? 'Search (press /)' : 'Search');
slash.checked = store('local', 'slash') !== 'off';
slashTitle();
slash.addEventListener('change', () => {
  store('local', 'slash', slash.checked ? 'on' : 'off');
  slashTitle();
});
d.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!slash.checked || e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (t.isContentEditable || t.matches('textarea,select,input:not([type=radio],[type=checkbox])')) return;
  e.preventDefault();
  input.focus();
  input.select();
});
// "clear the search" keeps the tab; "All" keeps the query.
reset.addEventListener('click', () => {
  if (clear) input.value = '';
  else radios[0].checked = true;
  transition(() => { if (!clear) root.dataset.tab = 'all'; apply(1); });
  input.focus();
});

// Focus leaving the open About panel closes it (its own buttons toggle it on click).
const about = $('#about');
d.addEventListener('focusin', (e) => {
  if (about.matches(':popover-open') && !about.contains(e.target) && !e.target.closest('[popovertarget=about]')) about.hidePopover();
});

const con = $('#console'), restart = (el, c) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); };
con.disabled = false; // disabled in the HTML: it needs this script
con.addEventListener('click', () => {
  const el = live.find((x) => x.offsetParent && $('a.hl', x));
  if (!el) return;
  const go = () => {
    el.scrollIntoView({ block: 'center', behavior: reduce.matches ? 'instant' : 'smooth' });
    $('a.hl', el).focus({ preventScroll: true });
    restart(el, 'land');
  };
  if (reduce.matches) return go();
  restart(con, 'feed');
  setTimeout(go, 720);
});

for (const el of live) {
  const a = $('a.hl', el);
  if (a) $('.mt', el).append(mk('button', 'share', null, { type: 'button', ariaLabel: `Share: ${a.textContent}` }));
}
d.addEventListener('click', async (e) => {
  const it = e.target.closest('.more,.ex')?.parentNode.closest('.it'), m = it && $('.more', it), b = e.target.closest('.share');
  if (m) m.ariaExpanded = it.classList.toggle('open');
  if (!b) return;
  const a = $('a.hl', b.closest('.it')), data = { title: a.textContent, url: a.href };
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) return navigator.share(data).catch(() => {});
  const ok = await Promise.resolve().then(() => navigator.clipboard.writeText(a.href)).then(() => 1, () => 0);
  b.dataset.done = ok ? 'Copied' : 'Copy failed';
  say(ok ? 'Link copied' : 'Copy failed');
  clearTimeout(b.t);
  b.t = setTimeout(() => delete b.dataset.done, 1800);
});

// Toggles only where the clamp hides text; rechecked on resize and filter changes.
function toggles() {
  for (const p of $$('#stream .ex')) {
    const it = p.parentNode, m = $('.more', it), need = p.scrollHeight > p.clientHeight + 1;
    if (!m && need) {
      const label = `Show the whole excerpt: ${$('.hl', it).textContent}`;
      $('.mt', it).insertBefore(mk('button', 'more', null, { type: 'button', ariaExpanded: 'false', ariaLabel: label }), $('.share', it));
    } else if (m && !need && !it.classList.contains('open') && !cl.contains('searching') && m !== d.activeElement) m.remove();
  }
}
let resized;
addEventListener('resize', () => { clearTimeout(resized); resized = setTimeout(toggles, 250); });

$('.deep-yr').style.setProperty('--from', Math.max(2009, (live.length ? new Date(Date.parse(live.at(-1).dataset.published)) : now()).getFullYear() - 1));

addEventListener('load', () => (W.requestIdleCallback || setTimeout)(() => {
  cl.add('settled');
  $('.artifact img').loading = 'eager';
  toggles();
}, { timeout: 400 }));

// Mail call: re-read news.json every 10 minutes while visible; newer stories light the slot.
const title = d.title, seenMax = Math.max(0, ...live.map((el) => Date.parse(el.dataset.firstSeen) || 0));
let told = 0;
setInterval(async () => {
  if (d.hidden) return;
  try {
    const n = (await (await fetch('/news.json', { cache: 'no-cache' })).json()).items.filter((i) => Date.parse(i.firstSeen) > seenMax).length;
    if (!n || n === told) return;
    const msg = `${count((told = n), 'new story', 'new stories')} just came in.`;
    cl.add('lit');
    caption();
    // No #fragment: a same-URL link with one only scrolls.
    const u = new URL(location.href);
    u.hash = '';
    fresh.replaceChildren(`${msg} `, mk('a', '', 'Refresh', { href: u.href }));
    say(msg);
    d.title = `(${n}) ${title}`;
  } catch {}
}, 6e5);
