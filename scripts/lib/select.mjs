// Merge with previous items, dedupe, sort, the live pick (window, caps, floors, top-up), Dolphin chip.
// See docs/ARCHITECTURE.md section 5.6.

import { titleKey, isHttpUrl, publisherSuffixPattern } from './text.mjs';
import { isExcluded } from './filter.mjs';
import { DAY, isoSeconds, toMs } from './util.mjs';

export const DOLPHIN_ID = 'dolphin';
// Two different publishers' items merge by title only when it is this specific: "Help" or "Is this legit?"
// posted to both subreddits are different posts, a 5-word headline crossposted is the same story.
export const TITLE_MERGE_MIN_WORDS = 5;
const RELEASE = /Release\s+(\d{4,})/i;

/** Item with keys in the contract order (section 4.1); `via` only when set. */
export function toItem(it) {
  const out = {
    id: it.id,
    title: it.title,
    url: it.url,
    source: it.source,
    sourceId: it.sourceId,
  };
  if (it.via) out.via = it.via;
  out.tab = it.tab;
  out.published = it.published;
  out.firstSeen = it.firstSeen;
  out.excerpt = it.excerpt ?? '';
  out.matched = Array.isArray(it.matched) ? [...it.matched] : [];
  return out;
}

/** Ranking used to pick the copy that survives a dedupe: publishers beat aggregators, then priority. */
export function sourceRank(source) {
  if (!source) return -Infinity;
  const p = Number.isFinite(source.priority) ? source.priority : 1;
  return source.aggregator ? p - 1e6 : p;
}

/**
 * Bring a candidate in line with the current config, or return null to drop it:
 * unknown source, excluded title, non-http(s) URL, or unusable dates.
 */
function reconcile(item, src, excludes) {
  if (!item || !src) return null;
  if (typeof item.title !== 'string' || !item.title || typeof item.id !== 'string' || !item.id) return null;
  if (!isHttpUrl(item.url)) return null;
  if (isExcluded(item.title, excludes)) return null;
  let published = toMs(item.published);
  let firstSeen = toMs(item.firstSeen);
  if (!Number.isFinite(published) && !Number.isFinite(firstSeen)) return null;
  if (!Number.isFinite(published)) published = firstSeen;
  if (!Number.isFinite(firstSeen)) firstSeen = published;
  return toItem({
    ...item,
    tab: src.tab,
    source: src.aggregator ? item.source || src.name : src.name,
    via: src.aggregator ? src.name : undefined,
    published: isoSeconds(published),
    firstSeen: isoSeconds(firstSeen),
  });
}

function better(a, b) {
  // Higher source rank wins; then fresher data (this run > cached > previous); then earlier firstSeen; then id.
  if (a.rank !== b.rank) return a.rank > b.rank ? a : b;
  if (a.origin !== b.origin) return a.origin > b.origin ? a : b;
  if (a.item.firstSeen !== b.item.firstSeen) return a.item.firstSeen < b.item.firstSeen ? a : b;
  return a.item.id <= b.item.id ? a : b;
}

const minIso = (a, b) => (a <= b ? a : b);

/** Sort newest published first; ties: firstSeen desc, then id. */
export function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.published !== b.published) return a.published < b.published ? 1 : -1;
    if (a.firstSeen !== b.firstSeen) return a.firstSeen < b.firstSeen ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Dedupe entries ({ item, origin, rank, aggregator }) by id, then by title key. The title key drops a
 * trailing " - Publisher" for any publisher name known in this run (configured source names and every
 * candidate's publisher). Copies from the same non-aggregator source are never merged by title (two
 * different r/wii posts may both be called "Help"); copies from two different non-aggregator sources
 * only when the title key has TITLE_MERGE_MIN_WORDS words or more; an aggregator's copies always. The
 * surviving copy keeps the earliest firstSeen of its group.
 */
export function dedupe(entries, publisherNames = []) {
  const suffix = publisherSuffixPattern([...publisherNames, ...entries.map((e) => e.item.source)]);
  const byId = new Map();
  for (const e of entries) {
    const prev = byId.get(e.item.id);
    if (!prev) {
      byId.set(e.item.id, e);
      continue;
    }
    const win = better(prev, e);
    byId.set(e.item.id, { ...win, item: { ...win.item, firstSeen: minIso(prev.item.firstSeen, e.item.firstSeen) } });
  }
  const byKey = new Map();
  const out = [];
  for (const e of byId.values()) {
    const key = titleKey(e.item.title, suffix ?? []);
    if (!key) {
      out.push(e);
      continue;
    }
    const group = byKey.get(key) || [];
    group.push(e);
    byKey.set(key, group);
  }
  for (const [key, group] of byKey) {
    const ranked = [...group].sort((a, b) => (better(a, b) === a ? -1 : 1));
    const specific = key.split(' ').length >= TITLE_MERGE_MIN_WORDS;
    const kept = [];
    for (const e of ranked) {
      const into = kept.find((k) => {
        if (k.item.sourceId === e.item.sourceId) return k.aggregator; // one aggregator's publishers: merge
        if (k.aggregator || e.aggregator) return true; // the publisher's copy beats the aggregator's
        return specific; // two publishers: only a specific headline is the same story
      });
      if (into) into.item = { ...into.item, firstSeen: minIso(into.item.firstSeen, e.item.firstSeen) };
      else kept.push({ ...e, item: { ...e.item } });
    }
    for (const k of kept) out.push(k); // a loop, not push(...kept): no argument limit
  }
  return out;
}

/** Keep at most `maxPerSource` (or the source's own maxItems) items per source, newest first. */
export function applyCaps(sorted, sourcesById, maxPerSource) {
  const counts = new Map();
  return sorted.filter((it) => {
    const src = sourcesById.get(it.sourceId);
    const cap = Number.isFinite(src?.maxItems) ? src.maxItems : maxPerSource;
    const n = counts.get(it.sourceId) || 0;
    if (n >= cap) return false;
    counts.set(it.sourceId, n + 1);
    return true;
  });
}

const TABS = ['press', 'scene'];

/**
 * The live list (section 5.6.4), from every candidate sorted newest first:
 *   1. the window: each source's stories within `windowDays`, newest first, up to its cap (`maxPerSource`, or
 *      the source's own `maxItems`);
 *   2. the floors: every source shows its newest `minPerSource` stories within `maxAgeDays` (its own cap
 *      permitting), and every tab at least `minPerTab`, from its own sources' older stories; past a source's
 *      cap only when no source of that tab has room left;
 *   3. the top-up (D6): older stories, within the caps, until there are `minItems`;
 *   4. the cap: at most `maxItems`, dropping the oldest window stories first, so the floors hold.
 * Steps 2 and 3 take stories one at a time from per-source queues (newest first): the head of the queue whose
 * source has the fewest stories so far, ties broken by the newer head story, then by sourceId. So one busy
 * source cannot fill every slot, and the choice depends only on the stories and `nowMs`, never on the hour.
 *
 * Also returns `windowStart` and `completeSince` per view (all, press, scene): the later of windowStart and the
 * newest story inside the window that the pick left out (a capped source's next story, or one the cap dropped).
 * Above it the list holds every story the site knows, so a gap there is really quiet (section 6.2.3).
 */
export function pickLive(sorted, sourcesById, selection, nowMs) {
  const { windowDays, minItems, maxAgeDays, maxItems } = selection;
  const maxPer = Number.isFinite(selection.maxPerSource) ? selection.maxPerSource : Infinity;
  const minPerSource = selection.minPerSource ?? 0;
  const minPerTab = selection.minPerTab ?? 0;
  const windowStart = isoSeconds(nowMs - windowDays * DAY);
  const ageLimit = isoSeconds(nowMs - maxAgeDays * DAY);
  const capOf = (id) => (Number.isFinite(sourcesById.get(id)?.maxItems) ? sourcesById.get(id).maxItems : maxPer);
  const count = new Map(); // sourceId -> stories chosen so far
  const tabOf = new Map();
  const queues = new Map(); // sourceId -> the stories not chosen yet, newest first
  const chosen = []; // { it, floor }
  const n = (id) => count.get(id) || 0;
  for (const it of sorted) {
    if (it.published < ageLimit) continue;
    tabOf.set(it.sourceId, it.tab);
    if (it.published >= windowStart && n(it.sourceId) < capOf(it.sourceId)) {
      chosen.push({ it, floor: false });
      count.set(it.sourceId, n(it.sourceId) + 1);
    } else {
      if (!queues.has(it.sourceId)) queues.set(it.sourceId, []);
      queues.get(it.sourceId).push(it);
    }
  }
  const take = (id, floor) => {
    chosen.push({ it: queues.get(id).shift(), floor });
    count.set(id, n(id) + 1);
  };
  const best = (ok) => {
    let b = null;
    for (const [id, q] of queues) {
      if (!q.length || !ok(id)) continue;
      if (!b || n(id) < n(b) || (n(id) === n(b) && (q[0].published > queues.get(b)[0].published ||
        (q[0].published === queues.get(b)[0].published && id < b)))) b = id;
    }
    return b;
  };
  const room = (id) => n(id) < capOf(id);

  for (const [id, q] of queues) while (q.length && n(id) < Math.min(minPerSource, capOf(id))) take(id, true);
  for (const tab of TABS) {
    let have = chosen.filter((c) => c.it.tab === tab).length;
    for (; have < minPerTab; have++) {
      const id = best((s) => tabOf.get(s) === tab && room(s)) ?? best((s) => tabOf.get(s) === tab);
      if (id === null) break;
      take(id, true);
    }
  }
  const target = Math.min(minItems, maxItems);
  while (chosen.length < target) {
    const id = best(room);
    if (id === null) break;
    take(id, false);
  }

  let kept = chosen.map((c) => c.it);
  if (kept.length > maxItems) {
    const floor = sortItems(chosen.filter((c) => c.floor).map((c) => c.it)).slice(0, maxItems);
    kept = [...floor, ...sortItems(chosen.filter((c) => !c.floor).map((c) => c.it)).slice(0, maxItems - floor.length)];
  }
  const items = sortItems(kept);

  const shown = new Set(items.map((it) => it.id));
  const completeSince = { all: windowStart, press: windowStart, scene: windowStart };
  for (const it of sorted) {
    if (it.published < windowStart) break;
    if (shown.has(it.id)) continue;
    for (const v of ['all', it.tab]) if (v in completeSince && it.published > completeSince[v]) completeSince[v] = it.published;
  }
  return { items, windowStart, completeSince };
}

/**
 * pickLive's list for a list that is already capped per source (no per-source config at hand): the window, the
 * floors and the top-up to `minItems`, never more than `maxItems`.
 */
export function applyWindow(sorted, rules, nowMs) {
  return pickLive(sorted, new Map(), rules, nowMs).items;
}

/** The newest Dolphin "Release NNNN" item, or the previous chip if none is newer. */
export function latestDolphin(items, previous = null) {
  let best = null;
  for (const it of items) {
    if (it.sourceId !== DOLPHIN_ID) continue;
    const m = RELEASE.exec(it.title);
    if (!m) continue;
    // "Release 2407 and 2409": the highest number is the release being announced.
    const after = it.title.slice(m.index);
    const version = String(Math.max(...(after.match(/\d{4,}/g) || [m[1]]).map(Number)));
    if (!best || it.published > best.published) best = { version, url: it.url, published: it.published };
  }
  const prevOk = previous && typeof previous.version === 'string' && isHttpUrl(previous.url) && typeof previous.published === 'string';
  if (!best) return prevOk ? { version: previous.version, url: previous.url, published: previous.published } : null;
  if (prevOk && previous.published > best.published) return { version: previous.version, url: previous.url, published: previous.published };
  return best;
}

/**
 * The whole selection step.
 * @param {object} args
 * @param {object[]} args.previous items from the previous news.json
 * @param {object[]} args.cached cached items of sources that failed this run
 * @param {object[]} args.fresh items fetched (or reused on 304) this run
 * @param {object[]} args.sources feeds.json sources
 * @param {object} args.selection feeds.json selection rules
 * @param {RegExp[]} args.excludes compiled exclude patterns
 * @param {Date|number} args.now
 * @param {object|null} [args.prevDolphin] previous meta.dolphin
 * @returns {{ items: object[], all: object[], dolphin: object|null, counts: { press: number, scene: number },
 *   windowStart: string, completeSince: { all: string, press: string, scene: string } }}
 *   items = live items; all = every deduped candidate (newest first), used for the builder's memory
 */
export function selectItems({ previous = [], cached = [], fresh = [], sources, selection, excludes = [], now, prevDolphin = null }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const sourcesById = new Map(sources.map((s) => [s.id, s]));
  const entries = [];
  const add = (list, origin) => {
    for (const raw of list || []) {
      const src = sourcesById.get(raw?.sourceId);
      const item = reconcile(raw, src, excludes);
      if (item) entries.push({ item, origin, rank: sourceRank(src), aggregator: !!src.aggregator, sourceName: src.name });
    }
  };
  add(previous, 0);
  add(cached, 1);
  add(fresh, 2);

  const all = sortItems(dedupe(entries, sources.map((s) => s.name)).map((e) => e.item));
  const { items, windowStart, completeSince } = pickLive(all, sourcesById, selection, nowMs);
  const counts = { press: 0, scene: 0 };
  for (const it of items) if (it.tab in counts) counts[it.tab]++;
  return { items, all, dolphin: latestDolphin(all, prevDolphin), counts, windowStart, completeSince };
}
