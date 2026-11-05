# WiiVolve — architecture and build contract

This is the binding contract for everything in this repository. `PLAN.md` explains *why*; this file says *exactly what* each part must do and how the parts fit. If code and this file disagree, fix one of them in the same change.

---

## 1. Principles

1. **Static output only.** Everything deployed lives in `site/` and is served by Cloudflare Workers Static Assets with **no Worker script**.
2. **Pre-rendered.** `site/index.html` is complete, readable HTML. JavaScript only enhances (filters, search, relative times, "new" glow, share). With JS off the page must still show every item, the hero, the deep end and the footer.
3. **Zero runtime dependencies.** Build and check scripts are plain Node ES modules (`.mjs`) using only Node built-ins. Must run on Node 22 and later; CI pins Node 26 in every job, so a switch of the LTS line never happens unattended (move the pin deliberately, after `npm test` passes on the new version). Dev tooling (`tools/`) is also dependency-free. `wrangler` is only invoked through `npx`, pinned to one verified version in CI and the npm scripts (`wrangler@4.157.0`; bump it deliberately after trying the new one with `npm run preview`); the owner's one-off commands in the RUNBOOK may use `wrangler@4`.
4. **CSP-safe markup.** The production Content-Security-Policy (section 9) forbids inline code. Therefore: no inline `<script>` (a `<script type="application/ld+json">` data block is fine), no `<style>` elements, **no `style="…"` attributes**, no `on*=` handler attributes, no `javascript:` URLs. JS may change styles through classes, `element.style` / CSSOM, or custom properties set from script.
5. **Untrusted input.** Every string that came from a feed is HTML-escaped on output; attribute values are attribute-escaped; only `http:`/`https:` URLs are ever emitted as links.
6. **Deterministic builds.** Rendering is a pure function of its inputs (no `Date.now()`, no randomness), so tests can snapshot it and the builder can detect real changes.
7. **Accessible.** WCAG 2.2 AA. Details in section 8.

---

## 2. Repository layout

```
.
├── PLAN.md                     product plan (why)
├── README.md                   what it is, local dev, editing feeds
├── LICENSE                     MIT for code; site text © Ali Kurnaz; the 2006–2008 material stays its authors'; font is OFL
├── package.json                npm scripts only; no runtime deps
├── wrangler.jsonc              assets-only Worker config
├── feeds.json                  sources, keywords, selection rules, site metadata
├── docs/
│   ├── ARCHITECTURE.md         this file
│   └── RUNBOOK.md              one-time setup, launch checklist, operations
├── .github/workflows/site.yml  hourly build + deploy, weekly self-check
├── templates/
│   └── index.html              page template with slots (owned by the design)
├── scripts/
│   ├── build-news.mjs          CLI: fetch → parse → filter → select → render → write
│   ├── build-legacy-map.mjs    CLI: legacy-assets/headlines-full.json + wayback-url-index.json → site/legacy-map.json (npm run legacy-map)
│   ├── check.mjs               CLI: weekly self-check, files/updates/closes one GitHub issue
│   ├── commit-if-changed.sh    used by CI: commits exactly the six generated files
│   └── lib/
│       ├── fetch.mjs           polite fetching with timeouts, conditional requests
│       ├── parse.mjs           tolerant RSS 2.0 / RSS 1.0 / Atom parser
│       ├── text.mjs            entity decoding, HTML stripping, truncation, normalization
│       ├── filter.mjs          Wii keyword rules, exclusions
│       ├── select.mjs          merge with previous items, dedupe, window and caps
│       ├── feeds-out.mjs       RSS 2.0 and JSON Feed 1.1 writers
│       ├── render.mjs          renderPage() — owned by the design
│       └── util.mjs            hashing, stable JSON, ISO dates, atomic writes
├── tests/                      node --test; fixtures/ holds the frozen test inputs: one saved feed per source and
│                               a copy of the launch feeds.json (only tests/config.test.mjs reads the real one,
│                               for invariants; see 8)
├── state/state.json            builder memory (committed, not deployed)
├── site/                       the deployed directory (see section 7)
├── assets-src/                 sources of the icons and og.png (HTML/SVG) + render.mjs; not deployed
├── tools/                      dev only: serve.mjs, shoot.mjs, qa.mjs, offline.mjs (npm run build:offline), candidate.mjs,
│                               font-coverage.mjs (the display face's characters, for render.mjs)
├── legacy-assets/              recovered 2006–2014 material, reference only, not deployed
└── work/                       scratch, git-ignored (npm run build:offline writes its preview to work/offline/)
```

---

## 3. Configuration: `feeds.json`

The file is JSON. Comments (`//`, `/* */`) and trailing commas are tolerated, as in this annotated example: the builder and `check.mjs` strip them, outside strings only. A value of the wrong type (a string where a list belongs, `minItems` above `maxItems`) stops the build with exit code 1 instead of emptying the page; the live site keeps its last deploy.

```jsonc
{
  "site": {
    "url": "https://wiivolve.com",          // canonical origin, no trailing slash
    "name": "WiiVolve",
    "title": "WiiVolve.com — WiiVolving Around You",   // <title> and og:title, the share card's title
    "tagline": "WiiVolving around you since 2006.",
    "description": "Fresh Nintendo Wii news and homebrew scene activity, gathered every hour, on the site that covered the Wii from 2006 to 2008.",
    "author": "Ali Kurnaz",
    "since": 2006,
    "wiiLaunch": "2006-11-19"               // North American launch; drives the counter
  },
  "selection": {
    "windowDays": 14,      // "fresh" window
    "minItems": 30,        // if the window holds fewer, top up with the newest older items…
    "maxAgeDays": 400,     // …but never older than this
    "maxItems": 60,        // hard cap on live items
    "maxPerSource": 12,    // per-source cap (a source may override with its own maxItems)
    "minPerSource": 2,     // floors (5.6): every source shows its newest 2 within maxAgeDays…
    "minPerTab": 8         // …and each tab at least 8; both optional, 0 when absent
  },
  "wiiU": false,           // true also accepts "Wii U" mentions
  "keywords": ["Wii", "Wiimote", "Wii Remote", "Nunchuk", "WiiWare", "Wii Sports", "Wii Fit", "Wii Shop",
               "WiiConnect24", "Balance Board", "MotionPlus", "Homebrew Channel", "Wiimmfi", "WiiLink", "RiiConnect24"],
  "exclude": ["megathread", "help thread", "memery monday", "what are wii playing wednesday"],   // case-insensitive regex sources, tested against titles
  "userAgent": "Mozilla/5.0 (compatible; WiiVolveBot/1.0; +https://wiivolve.com/)",
  "sources": [
    { "id": "nintendolife", "name": "Nintendo Life", "tab": "press", "filter": "keywords", "priority": 2,
      "url": "https://www.nintendolife.com/feeds/latest", "homepage": "https://www.nintendolife.com" }
    // … one entry per source; optional fields:
    //   "aggregator": true          (Google News: publisher comes from <source>, lower priority in dedupe)
    //   "userAgent": "…"            (this source's own UA string; "browser" sends a desktop Chrome UA)
    //   "maxItems": 10              (per-source cap override)
    //   "strip": ["regex", …]       (boilerplate to remove from excerpts)
  ]
}
```

Sources at launch (all probed 2026-11-04):

| id | name | tab | filter | url |
|---|---|---|---|---|
| nintendolife | Nintendo Life | press | keywords | https://www.nintendolife.com/feeds/latest |
| gonintendo | GoNintendo | press | keywords | https://gonintendo.com/feeds/all.xml (`/feeds` itself is an HTML directory of feeds) |
| nintendoeverything | Nintendo Everything | press | keywords | https://nintendoeverything.com/feed/ |
| timeextension | Time Extension | press | keywords | https://www.timeextension.com/feeds/latest |
| googlenews | Google News | press | keywords, aggregator | https://news.google.com/rss/search?q=%22Nintendo+Wii%22&hl=en-US&gl=US&ceid=US:en |
| hackaday | Hackaday | scene | keywords (the tag pulls in posts that mention the Wii once) | https://hackaday.com/tag/wii/feed/ |
| dolphin | Dolphin Emulator | scene | none | https://dolphin-emu.org/blog/feeds/ (Atom) |
| reddit-wii | r/wii | scene | none | https://www.reddit.com/r/wii/.rss (Atom, rate-limited, descriptive UA) |
| reddit-wiihacks | r/WiiHacks | scene | none | https://www.reddit.com/r/WiiHacks/.rss (Atom, rate-limited, descriptive UA) |

Reddit's API rules ask for a unique, descriptive User-Agent and ban clients that pretend to be a browser, so both subreddits send `web:com.wiivolve.news:v1.0 (+https://wiivolve.com/)`. Reddit's format ends with `(by /u/<username>)`: add the owner's Reddit username there once there is one (never an invented one). `/r/wii/.rss` is Reddit's "hot" listing, not "new": a low-voted post may never appear, which is accepted.

Observed reality (2026-11-04): the big outlets had **zero** Wii stories in their latest 25 items; Google News and r/wii carry most of the volume; Google News is relevance-ranked, so its items span months; some Google publisher names are domains (`www.wargamer.com`).

---

## 4. Data contracts

All timestamps are ISO 8601 UTC strings with a `Z` suffix and second precision (`2026-11-04T16:17:00Z`).

### 4.1 Item (shared by live and archive items)

```jsonc
{
  "id": "a3f9c1d2e4b5",          // live: first 12 hex chars of sha256(canonical URL); archive: "wv-…" slug
  "title": "Plain text",         // entities decoded, tags stripped, whitespace collapsed, ≤ 200 chars
  "url": "https://…",            // http(s) only; utm_*, fbclid, gclid removed
  "source": "Nintendo Life",     // display name; for Google News the publisher ("BGR"), "www." stripped
  "sourceId": "nintendolife",    // feeds.json id, or "wiivolve" for archive items
  "via": "Google News",          // optional: set when an aggregator delivered the item
  "tab": "press",                // "press" | "scene" | "archive"
  "published": "…Z",             // from the feed; clamped to firstSeen if missing, invalid or in the future
  "firstSeen": "…Z",             // when this site first saw it (see 5.5)
  "excerpt": "Plain text",       // ≤ 220 chars, ends with "…" when truncated, may be ""
  "matched": ["Wii"],            // keywords that matched; [] for unconditional sources and archive items
  "kind": "post",                // archive only (optional): "post" | "feature" | "review" | "preview" | "milestone"
  "note": "Where it all started" // archive only (optional): short label shown with the item
}
```

### 4.2 `site/news.json`

```jsonc
{ "version": 1,
  "generatedAt": "…Z",
  "items": [ Item, … ],                       // live items, newest published first
  "meta": {
    "dolphin": { "version": "2609", "url": "…", "published": "…Z" } | null,   // latest "Release NNNN" Dolphin post
    "counts": { "press": 12, "scene": 18 },
    "windowStart": "…Z",                                                     // now − windowDays (5.6)
    "completeSince": { "all": "…Z", "press": "…Z", "scene": "…Z" }           // per view: above it the list is complete (5.6)
  } }
```

### 4.3 `site/archive.json` (hand-curated once, committed)

```jsonc
{ "version": 1, "items": [ Item, … ] }   // tab "archive", source "WiiVolve", newest first; the last item is the Aug 26, 2006 coming-soon page
```

### 4.4 `site/health.json`

```jsonc
{ "version": 1,
  "generatedAt": "…Z",
  "sources": [ { "id": "reddit-wii", "name": "r/wii", "tab": "scene", "homepage": "https://www.reddit.com/r/wii/",
                 "status": "ok",          // "ok" latest fetch succeeded (incl. 304); "stale" failing < 3 runs in a row (cached items used); "down" ≥ 3 in a row
                 "lastOk": "…Z" | null, "failures": 0, "items": 9,   // items: live items currently shown from this source
                 "httpStatus": 200 | null, "error": null | "short message", "ms": 412 | null } ],
  "summary": { "ok": 9, "total": 9 } }    // ok counts "ok" only: a "stale" source is "Retrying", not OK
```

### 4.5 `state/state.json` (builder memory; committed, never deployed)

```jsonc
{ "version": 1,
  "signature": "sha256 hex",            // see 5.7
  "rulesHash": "sha256 hex",            // the filter rules and ENGINE_VERSION; see 5.10
  "lastWrite": "…Z",
  "seen": { "<id>": "<firstSeen>" },     // pruned to ids seen within the last 45 days
  "sources": { "<id>": { "etag": null, "lastModified": null, "lastOk": null, "lastAttempt": null,
                          "failures": 0, "httpStatus": null, "error": null,
                          "items": [ Item, … ] } } }   // last successful parse, filtered, ≤ 50 items
```

### 4.6 Feeds

* `site/feed.xml` — RSS 2.0 with `atom:link rel="self"`, one `<item>` per live item: `title`, `link`, `guid isPermaLink="false"` (= id), `pubDate` (RFC 822), `description` (excerpt), `source url="…"` (publisher name), `category` (tab).
* `site/feed.json` — JSON Feed 1.1: `version`, `title`, `home_page_url`, `feed_url`, `description`, `icon` (`/icon-512.png`), `favicon` (`/icon-192.png`), `language: "en"`, `items[]` with `id`, `url`, `title`, `content_text` (excerpt or title), `date_published`, `authors: [{ "name": source }]`, `tags: [tab]`.
* Both include only live items, never archive items.

---

## 5. The builder: `scripts/build-news.mjs`

```
node scripts/build-news.mjs [--offline] [--fixtures tests/fixtures] [--out site] [--state state/state.json]
                            [--config feeds.json] [--now 2026-11-04T16:17:00Z] [--force] [--quiet]
```

* `--offline` reads `<fixtures>/<sourceId>.xml` instead of the network (missing fixture = failed fetch). Used by tests and for design work without network.
* `--now` overrides the clock (tests, reproducible builds). Without it, the real time.
* `--force` writes outputs even when nothing changed (CI uses it on push so code changes always deploy).
* Exit code 0 unless there is a programming error or broken input (1: invalid `feeds.json`, a missing template or one without the `stream` and `status` slots, an `archive.json` that does not parse or has no items) or a usage error such as an unknown flag or invalid `--now` (2). Network failures are data, not crashes. Failing closed keeps the last good deploy live.
* When `GITHUB_OUTPUT` is set, append `changed=true|false` and `summary=<one line>`. When `GITHUB_STEP_SUMMARY` is set, append a Markdown table of sources.
* Writes are atomic (write temp file, rename).

### 5.1 Fetch
Node `fetch`, `AbortSignal.timeout(15000)`, different hosts in parallel; sources on the same host (the two subreddits) one after another, at least 3 s apart and longer when `x-ratelimit-*` / `Retry-After` say so (capped at 65 s), in an order that rotates by UTC hour. Headers: `User-Agent` (the source's own string, else the config's; `"browser"` sends a current desktop Chrome UA), `Accept: application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5`, `If-None-Match` / `If-Modified-Since` from state (none after a rules change, 5.10). One retry after ~2 s on network errors and 5xx (not on 4xx, nor on a redirect loop). Reject bodies over 5 MB. Decode using the charset from `Content-Type` or the XML declaration (UTF-8 default; handle ISO-8859-1 / windows-1252); a body labelled UTF-8 that is not valid UTF-8 and holds no UTF-8 multi-byte sequence at all is read as windows-1252 (the log line says so), while a mostly valid UTF-8 body keeps UTF-8. A 304 counts as success and reuses `state.sources[id].items`. Relative item links resolve against the feed's address after redirects.

### 5.2 Parse (`parse.mjs`)
`parseFeed(xmlText) → { format: "rss" | "atom" | "rdf" | "unknown", title, items: [{ title, link, description, content, published, updated, guid, author, sourceName, sourceUrl, categories }] }`. Regex/scanner based, tolerant of malformed XML (unescaped `&`, stray tags, missing closing tags, BOM, mixed CDATA). Atom `link`: prefer `rel="alternate"` (or no rel), then first `href`. Decode entities in text content; keep raw HTML for `description`/`content` (stripping happens in `text.mjs`). Never throws on bad input; returns `items: []`. Only the first 500 entries are read (`MAX_ENTRIES`, in document order: real feeds carry 10 to 100), so a 5 MB body of 150,000 tiny entries cannot exhaust the builder or bloat `state.json`. Every scanner is linear in the input (feed text is hostile, principle 5): no pattern may backtrack across the document, a tag name is matched whole, and an element repeated in one entry is taken out in one pass, so a 5 MB body of unclosed tags, a never-ending tag name, a DOCTYPE built to explode or one entry of 100,000 `<description>`s cannot stall the hourly job (`tests/hostile.test.mjs`). No call spreads a feed-sized list into function arguments (`push(...items)`), which overflows the stack.

### 5.3 Normalize (`text.mjs` + per-source rules)
* `title`: strip tags, decode entities (named HTML entities incl. `&nbsp;` `&mdash;` `&rsquo;` etc. and numeric), collapse whitespace, cap 200 chars.
* Google News: title arrives as `Headline - Publisher`; set `source` from `<source>` text (fallback: the suffix), strip the suffix from the title; `via: "Google News"`; prettify domain-like publisher names (`www.wargamer.com` → `wargamer.com`). Excerpt is `""` (Google's description only repeats the headline).
* Reddit: Atom; excerpt from the post body if any; remove the `submitted by /u/… [link] [comments]` boilerplate; `source` is the configured name (`r/wii`).
* Keyword text: description and content as plain text, but the content alone when it already holds the description (WordPress puts the start of the post in both, which would count one mention twice).
* Excerpt: from `description`/`content`, HTML stripped, boilerplate removed (source `strip` patterns plus common ones: "Read the full article on …", "The post … appeared first on …", "Continue reading …", "Read more »"), truncated on a word boundary to ≤ 220 chars with "…". Blocks stay apart: where a block break (a block tag such as `</p>`, `<br>` or `</li>`; in a field without any markup, a newline) separates two runs of text and the first does not end in terminal punctuation (`. ! ? … : ; , – — -`, optionally followed by a closing quote or bracket), they are joined with " — "; otherwise with a space ("make this game — No, I have no clue", not "make this game No, I have no clue"). In HTML a newline is only a space, as a browser shows it. Titles and the keyword text keep the plain space join.
* URL: `new URL()`, http(s) only (drop the item otherwise), lowercase host, remove `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, keep everything else.
* `published`: RFC 822 / ISO 8601 / RFC 3339; `updated` as fallback; invalid → firstSeen; more than 1 h in the future → firstSeen.

### 5.4 Filter (`filter.mjs`)
* The "Wii" token: case-insensitive, whole word, **not** followed by optional whitespace or dashes + `U` as a word (`Wii U`, `WiiU`, `Wii  U`, `Wii–U`, "the Wii U." rejected unless `wiiU: true`). `Wii's`, `Wii-era`, `wii sports` and `Wii U.S. sales` accepted. The Wii U titles that do not end in a bare "Wii U" (`Wii Party U`, `Wii Karaoke U`, `Wii Street U`, `Wii Sports Club`) never count.
* Every other keyword: case-insensitive, whole phrase, word boundaries; the space inside a phrase matches any whitespace or dashes. Overlapping keywords count once, and a bare "Wii" right before another keyword is the same mention (`Wii Nunchuk`, `Wii Balance Board` count once).
* `filter: "keywords"` sources: keep if the **title** matches, or if title + full description text contain **≥ 2** keyword occurrences.
* `filter: "none"` sources: keep everything.
* `exclude` patterns (titles, case-insensitive) drop items from every source.
* `matched` = distinct matched keywords in canonical casing.

### 5.5 firstSeen
`firstSeen = state.seen[id] ?? previousNews item's firstSeen ?? (published older than 48 h at discovery ? published : now)`. On the very first run (no previous news and no state, where an empty state file `{}` counts as none) every item gets `firstSeen = published` so launch day does not mark a year of posts as "new".

### 5.6 Select (`select.mjs`)
1. Candidates = previous `site/news.json` items (the site **accumulates**: feeds only expose their latest N entries, so an item stays until it ages out) ∪ freshly fetched items ∪ cached items of failing sources. Drop items whose `sourceId` is no longer configured or whose title now matches `exclude`.
2. Dedupe: by `id`, then by title key (lowercase, punctuation removed, trailing ` - Publisher` removed). Keep the higher `priority` source's copy (aggregators lowest); keep the earliest `firstSeen` of the group. Copies from one non-aggregator source never merge by title; copies from two different non-aggregator sources merge only when the title key has 5 words or more ("Help" in both subreddits is two posts, a crossposted headline is one story).
3. Sort by `published` descending (ties: `firstSeen` desc, then `id`).
4. The live pick (`pickLive`), from the candidates within `maxAgeDays`:
   1. **The window:** each source's items within `windowDays`, newest first, up to its cap (`maxPerSource`, or the source's own `maxItems`).
   2. **The floors:** every source shows its newest `minPerSource` items (its own smaller `maxItems` wins), and each tab (press, scene) at least `minPerTab`, from its own sources' older items. Past a source's cap only when no source of that tab has room left.
   3. **The top-up:** older items, within the caps, until there are `min(minItems, maxItems)`.
   4. **The cap:** at most `maxItems`, dropping the oldest window items first, so the floors hold.

   Steps 2 and 3 take items one at a time from one queue per source (newest first): the head of the queue whose source has the fewest items selected so far, ties broken by the newer head item, then by `sourceId`. The result is sorted by date again. So one busy source (Google News' relevance-ranked listicles, or two busy subreddits) cannot take every slot, quiet sources (Dolphin, Hackaday) stay on the page in a busy week, and the choice depends only on the items and the time, never on the hour's fetch order (no change, no deploy). On the launch data this gives 36 items: Press 8 (Google News), Scene 28.
5. **Completeness** (`news.meta`, for the quiet phrases of 6.2.3): `windowStart` = now − `windowDays`; `completeSince` per view (`all`, `press`, `scene`) = the later of `windowStart` and the newest item inside the window that the pick left out (a capped source's next item, or one the cap dropped). Above `completeSince` the view lists every item the site knows; below `windowStart` it lists picks only.
6. `meta.dolphin` = the newest `dolphin` item (shown or not) whose title matches `/Release\s+(\d{4,})/i`; keep the previous value if none in this run.

### 5.7 Change detection
`signature = sha256(stableJSON({ items: [[id, title, url, source, published, excerpt, tab, side]…], failing: [[id, status, min(failures, 3)] for every source whose status is not "ok", sorted by id], archive: sha256(archive.json), day: UTC date of now, rules: rulesHash }))`, where `side` says whether the item is older than `windowStart` and at or after `completeSince` of All and of its tab: those place the "Further back" line and decide the quiet phrases (6.2.3), so the page is rewritten when an item crosses one of them, and only then. If the signature equals `state.signature` and `--force` is not set: write nothing except `state/state.json` (updated source memory), report `changed=false`. Otherwise write all outputs and report `changed=true`. Including the UTC day guarantees one change per day, which (a) refreshes the pre-rendered date and countdown and (b) keeps the repository active so GitHub never pauses the schedule.

CI commits `site/` and `state/` only when `changed=true`, and every run starts from the last commit, so anything the builder remembers between runs must change the signature when it matters. That is why `failing` is there: each failure step of a source (`stale` 1, `stale` 2, `down` at 3) and its recovery changes the signature once, so the failure count is committed and a source failing every hour shows "down" on the third hourly run, as 4.4 says (`tests/build.test.mjs`, "CI replay"). The count is capped at 3, so a source that stays down costs no further commits. The cost: each failure episode commits and deploys up to four times (three steps and the recovery), and a source that fails every other hour does so every hour. Other memory of unchanged runs is still discarded with the runner, which is harmless: `lastOk`, `httpStatus` and `error` lag by at most a day in `health.json`; ETags and cached items are always committed together; `seen` only matters for items that were never shown.

### 5.8 Outputs (all in `--out`, default `site/`)
`index.html` (via `renderPage`), `news.json`, `feed.xml`, `feed.json`, `health.json`; plus `state/state.json`. `archive.json`, `404.html`, CSS, JS, fonts and images are source files, not build outputs.

### 5.9 Logging
One line per source: `ok    reddit-wii     200  412ms  25 parsed  9 kept`, with "(not UTF-8: read as windows-1252)" after a charset fallback. Then a one-line summary, which ends with "filter rules or engine changed: every feed fetched in full, N shown stories dropped" on the run after a rules change (5.10).

### 5.10 Rules changes
`rulesHash = sha256(stableJSON({ engine: ENGINE_VERSION, keywords, wiiU, exclude, sources: [[id, filter, strip, aggregator, tab]…] }))` (`rulesHashOf` in `build-news.mjs`), stored in `state.json`. `ENGINE_VERSION` (a constant in `build-news.mjs`, 3 since excerpts join their blocks) is bumped whenever `parse.mjs`, `text.mjs` or `filter.mjs` change which entries are kept or how they read. When the hash differs from the stored one, the run (a) sends no `If-None-Match` / `If-Modified-Since`, so every feed answers in full and no 304 hides an entry the new rules now want, and (b) re-checks the stories already shown or cached: one that its feed still carries goes by this run's verdict; an older one from a keyword source stays only if its title passes, or if every keyword it matched is still configured (its text is no longer at hand). The cache of a source that fails during that run is cleaned the same way, because the next runs reuse it without a rules change. So a keyword, `wiiU` or filter change, or an engine fix, reaches the page at the next build and stays, also when a source was down at the time. The rules hash is part of the change signature, so even a change that drops no story is committed once and the next hour's requests carry validators again. To remove one specific story for good, add an `exclude` pattern.

---

## 6. Rendering contract: `scripts/lib/render.mjs`

```js
export function renderPage({ template, news, archive, health, site, now }) // → string (complete HTML document)
```

* `template`: contents of `templates/index.html`. Slots are `<!--@name-->` and may sit inside attribute values; unknown slots render empty. The slots: `title`, `description`, `url` (origin, no trailing slash), `jsonld`, `htmlClass` (` class="bday"` on the birthday), `party` (the `party.css` link on the birthday), `launch`, `age`, `tagline`, `dolphin` (the latest-release chip), `cap` (console caption: the birthday one, else empty, 6.2.1), `nAll` / `nPress` / `nScene`, `stream`, `window` (`news.meta.windowStart`, in `#stream`'s `data-window`), `archive`, `sources` (About list), `status`, `generated`, `year`, `since`, `author`. Everything else in the page is static copy in the template.
* `news`, `archive`, `health`: the objects of section 4. `site`: `feeds.json#site` with its `url` normalized. `now`: a `Date`. `scripts/build-news.mjs` passes exactly these (archive from `site/archive.json`, health from this run).
* Pure, synchronous, deterministic. All build-time date logic in **UTC**; JS corrects to local time.
* Must escape everything and refuse non-http(s) URLs. Exports, all tested in `tests/render.test.mjs`: `renderPage`, `escapeHtml`, `safeUrl`, `ageLine`, `quietPhrase`, `statusLine`, `CAPTIONS`, `FURTHER`, `inDisplayFace`, `DISPLAY_COVERAGE`. Defensive guards on top of the builder's cleaning: a stylesheet rule leaked into the start of an excerpt is dropped, a `www.` prefix is dropped from publisher names, future dates are clamped to `now`, and `=` is also encoded inside the `data-source` attribute.
* **Page budget guard:** if the page would exceed 63 KB raw or 15.5 KB gzip (section 8's budgets, with room to spare), live excerpts are re-rendered shorter (160, 120, 90, 60 characters on a word boundary with "…"), then dropped. Deterministic (zlib is); a no-op on normal days. Sixty real stories from the saved feeds need it (`tests/render.test.mjs`).
* `site/404.html` is a static source file that loads `style.css` plus `404.css`, and a small external script (`404.js`) for the legacy-link bounce (section 7.4).

### 6.1 Required page anatomy and hooks
These IDs and attributes are used by tests, the screenshot harness and `check.mjs`. Class names and everything else are free.

| Hook | Element | Purpose |
|---|---|---|
| `#main` | `<main>` | skip-link target; it starts at the stories (the hero is a labelled region before it) |
| `#console` | `<button>` in the hero | the console; jumps to the newest item. `disabled` in the HTML, enabled by app.js: without JS it does nothing, so it is not a tab stop |
| `#stream` | container of live items | `data-window`: `news.meta.windowStart` (6.2.3) |
| `#deep-end` | the divider band | "Eighteen quiet years." |
| `#archive` | container of archive items | |
| `#search` | `<input type="search">` | search box (may be `hidden` until JS runs) |
| `#about` | element with `popover` | About panel; opened by a control with `popovertarget="about"` |
| `#status` | footer health line | "9 of 9 sources OK · checked hourly"; `data-generated` holds the time of the last change, JS adds "Updated 9m ago" beside it |
| `[data-item]` | each live and archive item | with `data-id`, `data-tab`, `data-source`, `data-published`, `data-first-seen`; a live item after a true quiet gap also `data-qa` (All) and/or `data-qt` (its tab), 6.2.3 |
| `time[datetime]` | inside each item | absolute label in HTML; JS may make it relative |

Head must contain: `<meta charset>`, viewport (without `viewport-fit=cover`: nothing is drawn edge to edge, so iPhones keep the layout inside the safe area), `<title>`, description, canonical, Open Graph (`og:title`, `og:description`, `og:image` absolute `site.url + "/og.png?v=<fingerprint>"` (written into the template by `node assets-src/render.mjs`), `og:url`, `og:type`), `twitter:card=summary_large_image` with `twitter:image:alt`, `theme-color` for light and dark, `<link rel="alternate">` for both feeds, `<link rel="manifest">`, `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, the font preload, `/style.css`, `/print.css` with `media="print"`, `<script type="module" src="/app.js">` (not render-blocking: no `blocking` attribute, so first paint never waits for JS), and a `WebSite` JSON-LD block (with a `SearchAction` for `?q=`). On the birthday the renderer adds `<link rel="stylesheet" href="/party.css" id="party">`.

### 6.2 Page behaviour (all designs must implement)
1. **Hero.** Wordmark (new type in the display face; no "[2]", no imitation of Nintendo's "ii" figures), tagline, the console (CSS-drawn white slab lying on its side, slot across the front, glow = "something new"), and the Wii age line: before Nov 19 2026 "20 years in N days"; on Nov 19 of any year "Happy birthday, Wii. N today." (a no-break space after the comma keeps "Wii." with the greeting; birthday mode, warmer glow in both themes); otherwise "N years and M days old". Pre-rendered in UTC, recomputed in local time by JS. *As built:* the console is a low-angle product shot (top face in perspective, bevel, recessed slot, glow spilling onto the face and the floor). Under it a caption explains it (`#cap`: "The slot glows when something new arrives.", "Psst, something new. Press the console to jump in." when lit, "Party hat on, confetti out, slot glowing." on the birthday; the variants live in `data-` attributes). Only app.js lights the slot, so the HTML carries the birthday caption alone (the server lights the birthday glow itself) and app.js fills in the others; the caption's line is reserved, so nothing shifts. Beside the age line one signal slot (`.sig`) shows the new count or, when nothing is new, the latest Dolphin release from `news.meta.dolphin`, in the same cell (no layout shift). **Birthday mode** adds a party hat on the console and confetti from `site/party.css`, loaded only on the day (the renderer links it in UTC, app.js in local time).
2. **New since your last visit.** `localStorage["wiivolve:lastVisit"]` (ISO). On load: `prev = sessionStorage["wiivolve:prevVisit"] ?? localStorage["wiivolve:lastVisit"] ?? now − 24 h`; store `prev` in sessionStorage (so reloads in a session keep the same markers) and `now` in localStorage. An item is new when `firstSeen > prev`. If any: light the slot, show "N new since your last visit" (first visit: "N new in the last 24 hours", which is the window it counts; `sessionStorage["wiivolve:first"]` keeps that wording for the session), mark items with a visible word, not only color. Clicking the console feeds it a disc (a short insert animation into the slot), then scrolls to and focuses the newest visible item's link; under reduced motion it jumps at once. All storage access in try/catch; with `?now=` nothing is written.
3. **Stream.** Live items newest first, grouped by day ("Today", "Yesterday", weekday for the last 6 days, "Oct 26" beyond; items older than 45 days grouped by month "September 2026"), and by year with a **sticky year label** in a rail. Pre-rendered groups use UTC; JS regroups by local date on load and again whenever the local date changes while the page is open. **Quiet gaps:** when 7 days or more separate a group from the one before it, the spine turns dotted and the gap is written out ("Seven quiet days.", "Four quiet weeks.", "Two quiet months.", built toward the deep end's "Eighteen quiet years.", which stays fixed: it is true), but only where it is true: the older group's newest story is at or after that view's `news.meta.completeSince` (5.6), so the list above it is complete. Below the window the stream holds picks, a few per source, so there are no phrases there; instead one line, "Further back: a few picks per source." (`FURTHER`), heads the first group older than the window (a story older than the window never shares a group with a newer one, even on the same day). The renderer writes the All view in UTC and puts each true phrase on its story, for All (`data-qa`) and for the story's own tab (`data-qt`); app.js regroups by local date and places phrases and the line again for the stories a chip or search leaves visible: a phrase where the group's first visible story carries one for this view, none while searching, the line before the first visible story older than `#stream[data-window]`. The gap between two stories does not depend on the time zone, so local time only moves group starts. Without JS, a chip (CSS `:has()`) hides the phrases, which were measured for All. Editorial sources' headlines use the display face, set whole: a headline with a character the face's Latin subset lacks ("Ōkami", "‰", an arrow) gets class `sys` and the text face, so it never switches fonts mid-word (`DISPLAY_COVERAGE`, recomputed from the font file by `tools/font-coverage.mjs` and in the tests; every fixed text set in the display face is covered). Community posts (`r/…`) keep the text face.
4. **Deep end.** After the live items: the divider band (`#deep-end`) with the copy in section 10, the stats row, and the recovered teal-era header (as captured in 2009; the dark teal look began in July 2007) shown small as an artifact (`/legacy/header-2009.webp`, 800×125, with width/height attributes, `loading="lazy"`, descriptive alt). Then the archive items (`#archive`) grouped by year, ending with the Aug 26, 2006 coming-soon page and the line "That’s the very first page. You made it all the way back to 2006. Back to today". *As built:* the band is night navy in both themes; its rail counts the year down from the year before the oldest live story to 2009 as it scrolls past (CSS scroll-driven animation, no year shown where unsupported). Archive headlines are set in Tahoma in the 2007 link navy, with 2007 date-bar dates ("Tuesday, September 4, 2007"; phones drop the weekday) and their notes as pills.
5. **Filters.** All / Press / Scene with counts. Filters apply to live items only. Must work by keyboard; prefer native radio inputs styled as chips (so they can even work without JS via `:has()`), with JS adding counts and URL state. Use the View Transitions API for filter changes when supported and motion is allowed. *As built:* with JS the filter is `html[data-tab]`, set inside `startViewTransition` so the list glides (a transition skipped by a newer one is not an error; the sticky bar is its own transition layer above the stories). A `?tab=` link filters after the first frame, so the stream keeps a minimum height reaching the bottom of the first screen (set once from script, cleared by the reader's next filter, search, reset or `Esc`, and never in print): a short tab never pulls the deep end up into view (a layout shift), and leaves no more blank than that.
6. **Search.** `#search` filters live **and** archive items by title, excerpt and source, case-, accent- and curly-apostrophe-insensitive, as you type (debounced). Archive items are searched by title and excerpt only (their source is always "WiiVolve", which any search for "wii" would hit). `/` focuses it (unless typing in a field, and unless the reader turned the shortcut off with the switch in the About panel, which is remembered in `localStorage["wiivolve:slash"]`: WCAG 2.1.4). `Esc` clears. A polite live region announces "N stories" (while searching: "N stories, plus M from the archive"): at once for chips, `Esc` and the button, and once the reader pauses typing for 0.7 s. Empty state on Press or Scene when All has a match: "No matches. Try All, or a shorter word.", where "All" is a real button that switches to All, keeps the query and puts the focus back in the field; on All, or when no tab has a match: "No matches. Try a shorter word, or clear the search.", where "clear the search" is the same button, clearing the query and keeping the tab. When no live story on any tab matches but archive items do, it says "No news matches. N headlines in the archive below."; when the archive has no hits either, the deep end and the closing line hide too. A day without live stories shows the quiet line, not the empty state, until a search finds nothing. Groups with no visible items are hidden. Hits are painted with the CSS Custom Highlight API, in headlines, excerpts and publisher names, in a yellow that keeps the text at 4.5:1 or more.
7. **URL state.** `?q=` and `?tab=press|scene` are read on load and kept in sync with `history.replaceState`. `?now=<ISO>` overrides the clock in JS (testing and screenshots only) and never writes storage.
8. **Items.** Headline link (opens the source; `rel="noopener"`), source name, time, optional excerpt (expandable; `<details name="…">` or clamp + toggle), "new" marker, and a share action added by JS (Web Share API, else copy link with a brief confirmation). *As built:* excerpts are plain paragraphs, clamped by CSS only under `@media (scripting: enabled)` (so they never shrink after first paint, and stay whole without JS); JS adds a chevron toggle with `aria-expanded` and a name that includes the headline only where text is hidden, and re-checks after a resize (a toggle that no longer hides anything goes). Below 360 px the toggle sits under Share, beside the excerpt, so the meta row keeps its room. The 44 px Share and toggle targets start 6 px above the meta row and never reach into the headline; their hover circle and focus ring are drawn round the icon (the top 34 px), so they never cover the excerpt below (forced colours keep a plain outline). Copying shows "Copied" or "Copy failed" for 1.8 s after the latest click. The meta row stays on one line: long publisher names and "via" shorten with an ellipsis, and "via Google News" is dropped below 480 px. Headlines and excerpts in right-to-left scripts keep their own direction (`unicode-bidi: plaintext`). The current Dolphin release item carries a "Latest release" pill.
9. **Relative time.** `time` labels become "2h ago", "Yesterday", etc. with the full local date in `title` (a story from the same local day is never "Yesterday", even on the 25-hour day when clocks go back); refreshed every minute while visible, on `visibilitychange` and when the page returns from the back-forward cache.
10. **About panel** (`#about`, native `popover`, works without JS): what this is, how it works (including that links found through Google News go through Google first), each source with its status from `health.json` ("Retrying" from the first failed hour, "Down" in the `--bad` colour from the third, in a grid so the status column lines up on phones; below 400 px the name takes its own row, so it never breaks inside a word), the switch for the `/` shortcut (JS only), the archive snapshot links (section 10), the RSS link, the Nintendo disclaimer. The page links neither GitHub nor the JSON Feed; `feed.json` is still built, and announced only by the `<link rel="alternate">` in the head for feed readers. Focus that leaves the open panel closes it, so the focused story is never behind it; focus on a button that opens the panel does not (its own click toggles it, so the About button also closes the panel).
11. **Footer.** `#status` health line, copyright `© 2006–YYYY Ali Kurnaz`, "Not affiliated with or endorsed by Nintendo.", links to RSS and About.
12. **States.** No JS: everything readable, controls that need JS hidden (reserve their space; no layout shift when they appear) or disabled (the console), and copy about them hidden (`.js-only`). Filter/search with no results: empty state. All sources down: status line says "Sources unreachable right now. Showing the last update." (also when every source failed the latest fetch, i.e. all `stale` or `down`). No live items at all: "The feeds are quiet right now. The next check is within the hour." Nothing new: no glow, no count. Print (`print.css`, `media="print"`): hero and controls hidden, clean list, headed "WiiVolve · wiivolve.com", each story's full local date printed beside the relative one, the "Further back" line kept as a line, no reserved height. Forced colours (Windows contrast themes): the console keeps an outline and a lit slot, icons and the selected chip use system colours.
13. **Motion.** Entrance and filter animations, the glow pulse; everything off under `prefers-reduced-motion: reduce` (glow becomes steady). *As built:* the glow ignites, breathes once and then holds (about 4.4 s, nothing loops). The hero and stories rise 10 px without fading (an opacity-0 start would keep the largest text out of LCP for over a second). Stories rise in only when the script runs before the first paint, so a late script never makes them blink.
14. **Dark mode.** Automatic via `prefers-color-scheme`; tokens on `:root`, overridden in the media query; `color-scheme: light dark`.
15. **Mail call.** While the page stays open and visible, JS re-reads `/news.json` every 10 minutes. Stories first seen after the newest one on the page light the slot, add "(N)" to the tab title and show "N new stories just came in. Refresh" (also announced in the live region); the Refresh link drops any `#fragment`, because a same-URL link with one only scrolls.
16. **Phones (< 760 px).** The bar has two rows: brand and About scroll away; chips and search stay sticky. Search is a 44 px circle until it is focused (then it takes the row and the chips step aside) or holds a query (then it fills the space beside the chips). No horizontal scroll at 320 px.

---

## 7. `site/` — the deployed directory

| Path | Kind | Notes |
|---|---|---|
| `index.html` | generated | |
| `news.json`, `feed.xml`, `feed.json`, `health.json` | generated | |
| `archive.json` | source | curated once |
| `legacy-map.json` | generated by `npm run legacy-map` from `legacy-assets/headlines-full.json` and `wayback-url-index.json`, committed | old endpoint + id → best Wayback capture, and each endpoint's list page (7.4) |
| `404.html`, `404.js`, `404.css` | source | "No disc inserted." (the disc lies on the floor beside the console); legacy bounce (7.4) |
| `style.css`, `app.js` | source | the page; within the section 8 budgets |
| `print.css`, `party.css` | source | loaded only when needed: `media="print"`, and on November 19 (section 6.2.1) |
| `fonts/bricolage-grotesque-96.woff2`, `fonts/OFL.txt` | source | Bricolage Grotesque, opsz 96, wght 200–800, Latin subset (41 KB); `font-display: swap`; preload |
| `legacy/header-2009.webp` | source | the recovered teal-era wordmark artifact, as captured in 2009 (the file name stays: it is immutable-cached) |
| `favicon.svg`, `favicon.ico` (16 and 32 px), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og.png` (1200×630) | source | rendered with `tools/shoot.mjs` by `node assets-src/render.mjs` from the HTML/SVG in `assets-src/`, which draw the console with the real `style.css` (the share image is the wordmark alone, centred); the maskable icon keeps the console inside the 80 % safe circle; the PNGs are 8-bit palette PNGs when ffmpeg is installed (optional step, about half the bytes) |
| `manifest.webmanifest`, `robots.txt`, `sitemap.xml` | source | |
| `_headers`, `_redirects`, `.assetsignore` | config | parsed by Cloudflare, never served |

### 7.1 `wrangler.jsonc`
`name: "wiivolve"`, `compatibility_date: "2026-11-04"`, `assets: { directory: "./site", not_found_handling: "404-page", html_handling: "auto-trailing-slash" }`, `workers_dev: true`, `preview_urls: false` (no public per-version copies of old builds), plus custom-domain routes for `wiivolve.com` (see RUNBOOK for DNS cleanup first). No `main`.

### 7.2 Caching
Defaults (`public, max-age=0, must-revalidate` with an ETag) for HTML, CSS, JS, JSON, XML. `Cache-Control: public, max-age=31536000, immutable` for the font file and the header artifact, named one by one (`_headers` rules also apply to 404 responses, so `/fonts/*` would cache a mistyped URL's 404 for a year); one day for the icons, `favicon.ico` and `og.png`. `tests/hosting.test.mjs` reads `_headers` and `_redirects` strictly (Cloudflare only warns about a bad line) and pins these rules.

### 7.3 Security headers (`_headers`, `/*`)
```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Strict-Transport-Security: max-age=31536000
```

### 7.4 Legacy links
Old WiiVolve URLs still appear in forums and old posts (`/fullNews.php?newsId=213`, `/review.php?articleId=77&page=1`, `/gameInfo.php?gameId=8`, `/cheat.php?gameId=134`, `/downloads/…`). They must land on the archived page, or, for a page that was never captured, on the closest archived page that lists it. `/rss.php` → `/feed.xml`, `/index.php` → `/` (301, permanent).

*As built and verified with wrangler dev 4.157.0:*

* **Endpoints with an id: `404.js` and `legacy-map.json`.** The four article endpoints (`fullNews.php?newsId=`, `article.php`, `review.php` and `preview.php?articleId=`) and the game and cheat pages (`gameInfo.php?gameId=`, `cheat.php?cheatId=` or `?gameId=`) have no rule in `_redirects`, and there is no `/*.php` catch-all (static rules beat splats, so a catch-all would answer them first, in every spelling). Their requests get `404.html` with status 404 at the original URL, and `404.js` sends them on with `site/legacy-map.json` (313 entries): a documented post, feature, review or preview to its best capture (188 of the 220 posts have no capture of their own, so Wayback's "2008" form of their URL is "not archived"), and each of the 7 game pages and 17 cheat pages the URL index lists with status 200 to that capture. An id the map does not know (newsId 12 was never documented; most game ids were never captured) goes to the best capture of the old site's own list for that endpoint, from the map's `_list`: the News Archive (February 2008), the features, the reviews A to Z, the previews, the game database (February 2008) and the cheats A to Z (all documented in `FACTS.md` section 2, except the cheats list, a capture from the URL index). The endpoint and parameter names match in any case, a trailing slash after `.php` and extra parameters (`&page=1`) are ignored. A map that fails to load or takes over 4 seconds, and a link without an id, fall back to `https://web.archive.org/web/2008/http://wiivolve.com<path><query>`. The console's slot glows during the bounce. Trade-off, accepted: these URLs answer 404 plus a browser-side redirect instead of a 301, so they need JavaScript; crawlers and link checkers see a 404 (the page is `noindex`). Without JS the 404 page offers the old site's own lists instead: the News Archive (February 2008, 218 posts), the reviews A to Z, the features, the game database, the cheats A to Z, and every capture.
* **Everything else: the edge.** `_redirects` sends every other `.php` endpoint in `legacy-assets/wayback-url-index.json`, the list pages after its alphabetical cut-off that `FACTS.md` documents (`reviews.php`, `staff.php`, `stats.php`) and the legacy folders (`/downloads/`, `/images/`, `/browser/`, `/gigazero/`, `/error/`) to the 2008 form with a **302** (a 301 without Cache-Control stays in browsers for good, and the best address for a page can change). `/downloads/*` stays at the edge: hotlinked images need a real redirect. Cloudflare keeps the incoming query string whenever the destination has none of its own. Rules match the path exactly and case-sensitively; `404.js` catches what they miss (other capitalisations such as `/Cheats.php`, a trailing slash, a folder without its slash, any other `.php` page) and sends it to the same place, restoring the old site's spelling of known endpoints and folders. It shows a "Taking you to the archive…" line with a manual link.
* **Checks.** `tests/legacy.test.mjs` runs `404.js` in `node:vm` against the map; `tests/hosting.test.mjs` asserts no rule answers an endpoint with an id and every other known endpoint keeps its rule; `tests/serve.test.mjs` pins `tools/serve.mjs` to wrangler dev's answers for a list of old URLs (paths match case-sensitively there too); `tools/qa.mjs` bounces `/fullNews.php?newsId=12` (the News Archive, from `_list`), `/FullNews.php/?NEWSID=213&page=1` and `/GameInfo.php?gameId=5` (the map) with web.archive.org stubbed, so QA never loads the Wayback Machine.

---

## 8. Quality bar

* **Accessibility:** skip link; landmarks; one `h1`; heading levels in order; lists for the stream; contrast ≥ 4.5:1 for text and ≥ 3:1 for UI in both themes (the slot blue is never body text); visible focus; 44 px targets; no hover-only information; `aria-live` result count; the console is a labelled button ("Jump to the newest story"); reduced motion respected.
* **Performance:** budgets per file, raw and gzip (what visitors download; `tools/qa.mjs` fails on a breach of either, and the renderer keeps `index.html` inside both, 6) — HTML ≤ 64 KB raw and 16 KB gzip, CSS ≤ 24 KB and 8 KB, JS ≤ 16 KB and 6 KB; font 41 KB; no images above the fold. CLS ≈ 0 (reserve space for JS-added controls). `content-visibility: auto` on stream groups with `contain-intrinsic-size`. *As built:* the budgets apply to `index.html`, `style.css` and `app.js`; print, birthday and 404 styles sit in their own small files so every visit does not pay for them. `content-visibility` is applied only under `@media (scripting: enabled)`, and app.js renders every group once the page is idle (`.settled`): without that pass, a jump to `#deep-end` with JS off moved the band as skipped groups rendered. Nothing JS changes after first paint moves the layout (excerpt clamps are CSS, reserved space for the search box, the signal slot and the caption), so CLS is 0 in every QA shot.
* **SEO/sharing:** section 6.1 head requirements; `robots.txt` allows all and points to `sitemap.xml`.
* **Tests:** `node --test` runs on every CI build before anything is written, so a test may never depend on what the owner edits in normal operation: the tests read frozen copies in `tests/fixtures/` (the saved feeds and `feeds.json` as of launch), and `tests/config.test.mjs` checks the real `feeds.json`, template and archive for invariants only (valid types, an offline build that runs), never ids, names or counts. Timing assertions in tests are generous (seconds for work that takes milliseconds).
* **QA:** `tools/qa.mjs` fails on a budget breach, any JS error, CSP violation or failed request in a shot, and on the per-shot checks: `/?q=wii` must finish app.js, the empty state keeps its button, a 320 px first visit keeps publisher names readable, the dark birthday glow is warm, Tab out of the About panel closes it, the 404 page has no sideways scroll at 320 px and offers the archive without JS, the three legacy bounces land where 7.4 says, and in All, Press and a search the quiet phrases and the "Further back" line sit where 6.2.3 says.

---

## 9. CI and operations (summary; details in RUNBOOK.md)

`.github/workflows/site.yml` (every job on Node 26, 1.3):
* `schedule: "17 * * * *"` → test, `build-news.mjs`, commit + `npx wrangler@4.157.0 deploy` when `changed=true`. An unchanged run compares the committed `site/health.json` `generatedAt` with the live one and deploys again when they differ (or the live one does not load), so a failed deploy is retried every hour.
* `push` to `main` and `workflow_dispatch` → test, `build-news.mjs --force`, commit if changed, deploy.
* The repository variable `DEPLOY_HOLD=true` pauses every deploy (builds and commits go on), for example to keep a `wrangler rollback` in place while a fix is prepared.
* Builds share one concurrency group with `queue: max`, so a push run waiting behind a running build is never cancelled by the next hourly run. When the commit step's rebase brings in a newer push that changes other files (code, CSS, `feeds.json`), it reports `superseded=true` and this run does not deploy: its page was built from the older files, and the run for that push deploys a consistent build.
* The checkout does not persist the token; only the Commit step gets it, so no other step (wrangler included) can push to the repository.
* `schedule: "0 9 * * 1"` → `check.mjs` (weekly self-check).
* `pull_request` to `main` → test and a dry offline build only; never commits or deploys.
* Deploy is skipped with a warning when `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are absent.
* Pushes made with `GITHUB_TOKEN` do not trigger new runs, so there are no loops.

`scripts/check.mjs`: checks the live site responds, `health.json` is < 26 h old, sources `down` for > 7 days, every `web.archive.org` link on the live page, and that both feeds parse. The archive links share an 8-minute budget and stop after three links in a row that Wayback does not answer; links left over are a note, not a problem, so a slow Wayback Machine cannot push the job past its 30-minute timeout. A link that answers 404 or 410 is asked again a minute later before it counts as broken; when the budget leaves no time for that second ask, it is unverified (a note), never broken on one answer. Problems → one GitHub issue labelled `site-check` (create or comment). All clear → close the open `site-check` issue with a note. Without `GH_TOKEN` it prints the report and exits 1 on problems.

---

## 10. Copy

* **Title:** WiiVolve.com — WiiVolving Around You (`site.title`; also the share card's title)
* **Hero:** WiiVolve · WiiVolving around you since 2006. · {age line} · {N new since your last visit}
* **Deep end heading:** Eighteen quiet years.
* **Deep end body:** From 2006 to 2008, WiiVolve covered the Wii several times a week, and almost daily around launch: news, reviews, previews, cheats, and Direct2Wii, a newsletter delivered to the console itself. The last post, in March 2008, promised a reconstruction. This is it.
* **Quote:** "…a group of unpaid high school students in the middle of their school years." — WiiVolve Reconstruction Plan (linked to `https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267`), March 1, 2008
* **Stats row:** 220+ posts · ~70 articles · 260+ games · 144 archive captures (the evidence is in `legacy-assets/FACTS.md` sections 1 and 2)
* **Header artifact caption:** "The teal-era header, as captured in 2009, recovered from the Wayback Machine. See the teal era" (the dark teal look began in July 2007; the 2009 capture shows it best)
* **Archive snapshot links (About panel):** 2007 heyday `https://web.archive.org/web/20070703152325/http://wiivolve.com/` · Coming-soon page `https://web.archive.org/web/20060826001626/http://wiivolve.com/` · The last post `https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267` · The teal era `https://web.archive.org/web/20090802061250/http://wiivolve.com/` ("from July 2007 · captured August 2, 2009") · Every capture `https://web.archive.org/web/2007*/wiivolve.com` ("August 2006 to July 2025", FACTS 2 and 5.5: the calendar opens on the heyday year, not on an empty 2026)
* **About:** "WiiVolve was a Wii news site from 2006 to 2008. It's back as a single page that gathers Wii news and homebrew scene activity from around the web every hour and links you to the source." · "How it works: every hour a small script reads the sources below, keeps what's about the original Wii, removes duplicates and rebuilds this page. Nobody edits the list by hand. Links to stories found through Google News go through Google first." · switch (JS only): "Press / anywhere to search"
* **Status:** "9 of 9 sources OK · checked hourly" (a source counts as OK when its latest fetch worked: one shown as "Retrying" makes it "8 of 9") / "Sources unreachable right now. Showing the last update." (JS adds "Updated 20h ago": the time of the last change, which on a quiet day can be hours old although every source was checked within the hour)
* **Empty search:** "No matches. Try All, or a shorter word." (Press or Scene, when All has a match) / "No matches. Try a shorter word, or clear the search." (All, or no match on any tab)
* **Footer:** © 2006–{year} Ali Kurnaz · Not affiliated with or endorsed by Nintendo. · RSS · About
* **404:** "No disc inserted." · "This page isn't here. If you followed an old WiiVolve link, it's probably in the archive." · "Back to WiiVolve" · "The old site's own lists, in the Wayback Machine: the news archive · reviews A to Z · features · the game database · cheats A to Z · every capture of the old site" (each link kept on one line, the paragraph balanced)
* **Birthday:** "Happy birthday, Wii. 20 today."
* **Microcopy added by the design** (template and app.js): console caption "The slot glows when something new arrives." / "Psst, something new. Press the console to jump in." / "Party hat on, confetti out, slot glowing." · signal slot "Latest Dolphin release: 2609" · first visit "N new in the last 24 hours" · quiet gaps "Seven quiet days." … "Two quiet months." (only where true, 6.2.3) · the line before the picks from further back "Further back: a few picks per source." · archive-only search "No news matches. N headlines in the archive below." · no live items "The feeds are quiet right now. The next check is within the hour." · mail call "N new stories just came in. Refresh" · page end "That’s the very first page. You made it all the way back to 2006. Back to today" · About snapshot note "August 26, 2006 · artwork not archived" · item pill "Latest release" · archive item note on the coming-soon page "(The page’s artwork was never archived.)", appended to its original tagline (an edit to the original text, listed in `legacy-assets/FACTS.md` section 8).
* **Copy decision (settled 2026-11-04):** the stats row and the deep-end body follow `legacy-assets/FACTS.md` (sections 2 and 3). The numbers live in `templates/index.html` only.
