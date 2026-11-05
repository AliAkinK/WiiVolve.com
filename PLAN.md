# WiiVolve 2026 — Plan

*v4, 2026-11-04. A complete spec: an original single page that is nice to look at, genuinely useful, and as automated as a static site can be. Inspired by the 2006–2008 site, not a rebuild of it.*

---

## 0. The short version

- **What:** one page at wiivolve.com built as a single stream of dated items: today's Wii news at the top, the site's own 2006–2008 headlines at the bottom, and a divider between them marking eighteen quiet years. Above it, a minimal white console whose disc slot glows blue when there is something new, the way a real Wii did.
- **Useful part:** hourly Wii news and scene activity from 9 validated RSS and Atom sources, filtered for the original Wii, de-duplicated, searchable, with RSS and JSON Feed as byproducts. Old wiivolve.com links from around the web bounce to the archived page instead of dying.
- **Automated part:** a GitHub Actions job rebuilds the page hourly, commits and deploys only when something changed, pre-renders the HTML so the page needs no JavaScript to read, and runs a weekly self-check that files a GitHub issue when something needs a person (a source counts only after a week down). Otherwise it never speaks.
- **Hosting:** Cloudflare Workers Static Assets, free, assets only, no server code. The domain is already on Cloudflare.
- **Effort:** about two and a half days to build. Human work after launch: renew the domain once a year. **Launch November 19, 2026, the Wii's 20th anniversary (North American launch).**

---

## 1. What WiiVolve was (recovered from archive.org)

Inspiration, not a template. Wayback holds 144 captures of the homepage (26 Aug 2006 to 14 Jul 2025) and 400+ unique URLs under the domain.

**Identity.** *WiiVolve: WiiVolving Around You*. Earlier: *"Your Number One Source for Wii News!"* © Ali Kurnaz. "WiiVolve is an extension of XiiNet", channel [2] in the numbered XiiNet network bar.

**Timeline of the site**
| Date | What the archive shows |
|---|---|
| 2006-08-26 | First capture: a "NEW SITE COMING SOON" page, three months before the Wii shipped. |
| 2006-11-07 | Launch-era splash page that sniffed the browser and sent Firefox users to `index.php?system=Wii` (and other browsers to `browser/*.html` notices; opened today in Chrome, Safari or Edge, the archived splash forwards to a Wayback "not archived" error). |
| 2007 | Full site: News Archive, Game Database, Features, Reviews, Previews, Screenshots, Cheat Codes, Message Boards, Wi-Fi Station, Direct2Wii, Mail Bag, Downloads, Contests, Polls. Busiest in launch month (posts on 26 of 30 days in November 2006); over the whole run, posts went up on 39% of days. Closed from April 18 to June 7, 2007 for the staff's final exams ("WiiVolve is Back on Track"). |
| 2007-07 | The dark black-and-teal look replaces the light skin (the dark stylesheet is live by July 7, 2007; teal links from July 12). |
| 2007-09-04 | Last regular news post ("New Nintendo Trademarks Hint at Future"). |
| 2007-10 to 2008-02 | The bare domain shows a black "reform" page ("Click here to continue on to WiiVolve."). |
| 2008-03-01 | "WiiVolve Reconstruction Plan", the final post: a pivot to reviews only and a brighter layout. It never shipped. |
| 2008-04 to 2009-03 | The bare domain is a frameset loading `http://www.mysticfox.info/wiivolve`. |
| 2009-04 to 2014-01 | The frozen dark homepage again; captures continue through January 2014. |
| 2016 | cPanel default page. Domain lapses; re-registered 2018-11-01. |
| 2026-11-04 | Domain on Cloudflare, returning a 523 (origin unreachable). |

**Scale (`legacy-assets/FACTS.md` sections 1, 2 and 7):** 220 documented news posts (the post-ID counter reached 267, but it ran ahead of the real count), about 70 long-form articles (40 reviews, 21 features, 8 previews; the article counter reached 105), about 265 game database entries (the game IDs tracked the real count and reached 268, so "260+"), cheat entries numbered to #66 by July 2007 (35 counted in February 2007), 526 screenshots in February 2007.

**The classic look (2007): white, grey and blue.** White page in an 800px column, light-grey left menu (`#f0f0f0`) with grey borders (`#d6d6d6`), navy links (`#2e4d7b`), a navy date bar (`#253e63`, "Tuesday, July 3, 2007"), black Tahoma 12px, news rows of thumbnail + headline + bold date + one-line blurb. Most of this skin's images were not archived.

**The final look (July 2007 to 2014): black and teal.** It replaced the light skin in July 2007 and stayed until the last capture; the August 2009 capture shows it fully rendered, and its stylesheet and all 14 skin images, including the 800×125 header wordmark, are saved in `legacy-assets/skin-2009/`.

**Direct2Wii.** A text-only newsletter emailed straight to Wii consoles over WiiConnect24: readers added `news@wiivolve.com` to the console address book and registered their 16-digit Wii Number. The console announced new mail by glowing blue at the disc slot. WiiConnect24 died in 2013, so there is nothing to repurpose; the glow lives on in the design and the story lives in the divider.

**Snapshots to link**
- 2007 heyday: `https://web.archive.org/web/20070703152325/http://wiivolve.com/`
- Coming-soon page: `https://web.archive.org/web/20060826001626/http://wiivolve.com/`
- The last post: `https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267`
- The teal era (from July 2007; captured August 2009): `https://web.archive.org/web/20090802061250/http://wiivolve.com/`
- All captures (August 2006 to July 2025; the `2007*` form opens the calendar on the heyday year instead of an empty current one): `https://web.archive.org/web/2007*/wiivolve.com`

---

## 2. Current state of the domain

| Item | Finding |
|---|---|
| Registrar | Namecheap, created 2018-11-01, expires 2027-11-01 |
| Nameservers | `angela.ns.cloudflare.com`, `sage.ns.cloudflare.com` |
| Today | `https://wiivolve.com` returns Cloudflare error 523: the DNS record points at an origin that no longer answers |

Assumption: this is your Cloudflare account. Attaching the domain to the new project also clears the 523.

---

## 3. Goals, constraints, non-goals

**Goals**
1. An original design that is fun, modern and smart, with the old site as inspiration.
2. Genuinely useful: the one page to check for Wii news and scene activity, readable without JavaScript, fast on a phone.
3. Automated end to end. If ignored for a year it keeps working, and it tells you only when a human is needed.

**Constraints**
- About two and a half days of build time in three milestones.
- Nothing that needs curating after launch. Anything that can rot is either checked by a machine or left out.
- No backend, no accounts, no framework, no npm dependencies in the build script.

**Non-goals**
- Comments, user reviews, forums. Re-hosting old downloads. Rebuilding the game database or cheats. Link directories. Email of any kind.

---

## 4. The design: one stream, from today back to 2006

**The idea.** The whole page is a single stream of dated items, newest first. Today's news is at the top. Scroll down and the dates run backwards: this week, this month, then a divider marking eighteen quiet years, then the original 2006–2008 WiiVolve headlines, and finally the first thing ever on wiivolve.com, the August 2006 "coming soon" page. The site ends where it began. Old and new items share one layout and one data shape.

**The hero: a console that lights up.** A real Wii told you something had arrived by glowing blue at the disc slot. The hero is a minimal white console drawn in CSS, lying on its side, with a thin slot that glows blue when there is something new since your last visit. Beside it: the wordmark, the line "Still spinning since 2006", and the anniversary counter in big numerals. Tap the console and it scrolls to the newest item. On a quiet day the slot is dark, like the real thing.

```
╭──────────────────────────────────────────────────────────────╮
│ WiiVolve                                   Press · Scene · ⌕ │  slim sticky bar
├──────────────────────────────────────────────────────────────┤
│   ┌───────────────────────┐    WiiVolve                      │
│   │ ░░░░░░░░░░░░░░░░░░░░░ │    Still spinning since 2006.    │
│   │ ════ slot, glowing ═══│    20 years in 15 days.          │
│   └───────────────────────┘    7 new since your last visit   │
│                                                              │
│ 2026 │ Today                                                 │
│      │ ● Headline, balanced wrapping              Nintendo   │
│      │   one-line excerpt · 2h                    Life       │
│      │ ● Headline                                 r/wii      │
│      │ Yesterday                                             │
│      │ ● …                                                   │
│      ⋮  the year on the rail counts down as you scroll       │
│ ──── eighteen quiet years ─────────────────────────────────  │
│      "a group of unpaid high school students…" · 2008        │
│      220+ posts · ~70 articles · 260+ games · 144 captures   │
│ 2007 │ ● New Nintendo Trademarks Hint at Future    Sep 2007  │
│      │ ● Stroke Victim Wants Wii-hab               Aug 2007  │
│      │ ● …                                                   │
│ 2006 │ ● "NEW SITE COMING SOON"                    Aug 2006  │
│      │   where it all started → archive.org                  │
├──────────────────────────────────────────────────────────────┤
│ about · rss · json · github · not affiliated with Nintendo   │
╰──────────────────────────────────────────────────────────────╯
```

**Visual language**
- Palette grown from the old one, not copied. Light: paper `#fbfbfc`, ink navy `#1b2a4a` (descended from the 2007 date bar and links), slate `#6b7280` secondary text, mist `#eef1f5` surfaces, and one accent, slot blue `#2f7df6`, used only for the glow, hover states and "new" markers (it is not contrasty enough for body text and is never used that way). Dark: ink becomes the page, paper the text, the surfaces go `#232f47`, the accent lightens to `#6ea4ff`. Both come from the system setting; no toggle to maintain.
- Type: Bricolage Grotesque, a free variable font, self-hosted as one Latin-subset woff2 (about 35 KB, `font-display: swap`, preloaded), for the wordmark, counters and day headers. System UI for everything else. Tabular numerals on counters and times.
- Scale: body 17px, line height 1.55, measure 680px; headline 20px; day headers 14px caps; the counter 56px on desktop, 40px on phones. Spacing on an 8px grid. Breakpoints at 480px and 760px, mostly handled by container queries on the stream.
- Shapes: pill corners everywhere, the way the console and the Remote were all soft radii. No gradients, no gloss. One shadow, under the console only.
- The console: a 5:2 rounded slab, inset slot line across the front third, two small dots for buttons. Glow is a `box-shadow` in slot blue that pulses once (1.2 s) when there is something new, then holds at a soft steady glow; no glow when nothing is new.
- Motion: items fade and slide in as they enter the viewport; filter changes animate with the View Transitions API; all of it off under `prefers-reduced-motion`.
- Wordmark: new, set in the display face, no "[2]" and no imitation of Nintendo's "ii" figures. The 2009 header art appears once, small, inside the divider band as an artifact.
- Favicon: an SVG of the slab with a glowing slot; an apple-touch-icon PNG and a web manifest so it installs to a home screen like a channel.
- Anniversary mode, automatic by date: every November 19 the hero reads "Happy birthday, Wii" with the age; on the 20th it reads "20 today" and the slot glows warmer for the day.

**Smart details that cost almost nothing**
- Day grouping with sticky headers ("Today", "Yesterday", "Nov 2"); older items group by month, archive items by year.
- A scroll-driven year label on the rail (`animation-timeline: scroll()`, no JS) that runs from 2026 down to 2006; browsers without it show a static label.
- "New since your last visit" from one localStorage timestamp; the glow and the count come from it. New items also carry a visible "new" word, not just color.
- Press / Scene / All chips with counts, and a search box that filters the loaded list, archive included, as you type. `/` focuses search.
- Expandable excerpts with `<details name="item">` (one open at a time); `<time>` elements with relative labels that refresh each minute while the tab stays open.
- A "Dolphin 2609" chip on the Scene filter, derived at build time from the latest "Dolphin Progress Report: Release NNNN" title.
- Share per item through the Web Share API where available; a plain copy-link elsewhere.
- Footer health line: "updated 12 min ago · 8 of 8 sources OK".

**Modern CSS on purpose, no build step:** nesting, container queries, `color-mix()`, scroll-driven animations, View Transitions, `@starting-style`, `popover` for the About panel, `<details name>`, `text-wrap: balance`, `content-visibility: auto`. Everything degrades to a plain, readable list in older browsers.

---

## 5. Features and states

### 5.1 The stream, top half: news
Items of headline, source, time, and an expandable one-line excerpt, newest first. Window: the last 14 days, or the 40 most recent items if 14 days hold fewer, so the list is never empty. Two filters, **Press** and **Scene**.

**Sources (all probed 2026-11-04)**
| Tab | Source | Feed | Handling |
|---|---|---|---|
| Press | Nintendo Life | `nintendolife.com/feeds/latest` | keyword filter (feed has no platform tags) |
| Press | GoNintendo | `gonintendo.com/feeds` | keyword filter |
| Press | Nintendo Everything | `nintendoeverything.com/feed/` | keyword filter |
| Press | Time Extension | `timeextension.com/feeds/latest` | keyword filter |
| Press | Google News, search "Nintendo Wii" | `news.google.com/rss/search?q=%22Nintendo+Wii%22&hl=en-US&gl=US&ceid=US:en` | catch-all; publisher from `<source>`; links are Google redirects and stay that way; dedupe hard |
| Scene | Hackaday, tag "wii" | `hackaday.com/tag/wii/feed/` | always include |
| Scene | Dolphin Emulator blog | `dolphin-emu.org/blog/feeds/` | always include (Atom) |
| Scene | r/wii and r/WiiHacks | `reddit.com/r/wii/.rss`, `reddit.com/r/WiiHacks/.rss` | always include; a descriptive User-Agent, as Reddit's API rules require (they ban clients that pose as browsers); best effort, Reddit rate-limits |

Tested and set aside: Bing News (duplicates Google), Mastodon hashtag feeds (noisy, no titles), GBAtemp (site-wide feed works, Wii sub-forum feeds return 403), WiiBrew recent changes (403), Wiimmfi stats (403), Dolphin's GitHub releases (404; they do not use releases), YouTube channel feeds (work, but someone would have to pick channels).

**Filter rules, all in `feeds.json`**
- Match `\bWii\b` not followed by `U`, plus: Wiimote, Wii Remote, Nunchuk, WiiWare, Wii Sports, Wii Fit, Wii Shop, WiiConnect24, Balance Board, MotionPlus, Homebrew Channel, Wiimmfi, WiiLink, RiiConnect24. Wii U is off by default; one flag turns it on.
- Press feeds: a title match passes, otherwise two or more matches in the body. Scene feeds pass unconditionally; the source is already Wii-scoped.
- Dedupe by normalized title (lowercase, no punctuation, publisher suffix stripped) and by URL with `utm_*` removed. Prefer the publisher's own feed over the Google copy.
- Stable identity across runs: each item's `id` is a hash of its canonical URL; `firstSeen` is carried over from the previous `news.json`, so "new" means new to the site, not whatever date a feed claims.
- Excerpts trimmed to about 200 characters of plain text, HTML stripped and entities decoded. Always link out.

**Feeds as a byproduct:** the same build writes `feed.xml` (RSS 2.0) and `feed.json` (JSON Feed 1.1) with the merged list, validated once with the W3C feed validator.

### 5.2 The stream, bottom half: the deep end (written once)
- The divider band: about 80 words on what WiiVolve was, the Reconstruction Plan quote, the Direct2Wii story in one line, the stats row, the small 2009 header artifact.
- `archive.json`: ten to twenty original headlines, hand-picked from the captures, in the same item shape as news, each linking to the archived homepage of its month. Candidates: "WiiWare Officially Has a Purpose" (Jun 27, 2007), "Nine-Day Warning: Internet Channel Not Free Forever" (Jun 21, 2007), "Sony Eats Nintendo's Dust" (Jun 25, 2007), "Jim Ward Talks Wii and Star Wars" (Jun 28, 2007), "Wii Smart Fortwo Fleet" (Jun 18, 2007), "Stroke Victim Wants Wii-hab" (Aug 9, 2007), "Metroid Month" (Aug 10, 2007), "Top Ten Finish for the Wii Car!" (Aug 12, 2007), "New Nintendo Trademarks Hint at Future" (Sep 4, 2007), "WiiVolve Reconstruction Plan" (Mar 1, 2008, has its own capture); features "How to Build a Wii Laptop" and "Serena Williams Plays Wii Sports".
- The last item in the stream: the August 2006 coming-soon page, "where it all started".

### 5.3 The hero
The console, the glow, the date line and the anniversary counter. The date and counter are pre-rendered at build time in UTC and corrected to local time by JS. After November 19 the counter reads "20 years and N days old".

### 5.4 The About panel (`popover`)
What the site is, how it works (hourly, the source list with each source's current status), the five archive snapshot links, RSS and JSON links, the GitHub repo, a "report a broken source" link that opens a pre-filled GitHub issue, and the Nintendo disclaimer. No email address.

### 5.5 States
| State | Behavior |
|---|---|
| No JavaScript | The full stream is already in the HTML. Filters and search are hidden; everything else reads fine. |
| Filter or search with no matches | "No matches. Try All, or a shorter word." |
| A source down this run | Item list unaffected; health line counts it; About panel marks it. |
| All sources down | The previous items stay (the build keeps the last good `news.json`); health line says "sources unreachable, showing the last update". |
| Nothing new since last visit | No glow, no count, nothing to say. |
| Old wiivolve.com URL (`/fullNews.php?newsId=213`, `/review.php?…`, `/gameInfo.php?…`) | An old article goes to its best capture (`site/legacy-map.json`, read by `404.js`); other old pages bounce to `https://web.archive.org/web/2008/http://wiivolve.com` + path + query at the edge. `/rss.php` goes to `/feed.xml`; `/index.php` goes home. See ARCHITECTURE 7.4. |
| Any other missing page | "No disc inserted." with a link home. |
| Printing | A print stylesheet drops the hero and chrome; the list prints clean. |

---

## 6. Copy deck (drafts to edit)

- **Title tag:** WiiVolve — Wii news, still spinning since 2006
- **Meta description:** Fresh Nintendo Wii news and homebrew scene activity, gathered every hour, on the site that covered the Wii from 2006 to 2008.
- **Hero:** WiiVolve · Still spinning since 2006. · 20 years in 15 days. · 7 new since your last visit
- **Divider:** Eighteen quiet years. From 2006 to 2008, WiiVolve covered the Wii several times a week, and almost daily around launch: news, reviews, previews, cheats, and Direct2Wii, a newsletter delivered to the console itself. The last post, in March 2008, promised a reconstruction. This is it. (Final; the earlier draft overstated the record, see `legacy-assets/FACTS.md` section 3.)
- **Stats row:** 220+ posts · ~70 articles · 260+ games · 144 archive captures (final, from `legacy-assets/FACTS.md` section 2)
- **Deep-end footer item:** August 26, 2006: "NEW SITE COMING SOON." Where it all started.
- **Health line:** updated 12 min ago · 8 of 8 sources OK
- **Footer:** © 2006–2026 Ali Kurnaz · Not affiliated with or endorsed by Nintendo · RSS · JSON · About · GitHub
- **404:** No disc inserted. · Back to WiiVolve
- **Anniversary day:** Happy birthday, Wii. 20 today.

---

## 7. Architecture and automation

*A planning sketch from before the build. Where it differs, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the contract: wrangler is pinned to one version (4.157.0) and CI to Node 26, the bot commits as `github-actions[bot]`, `health.json` may be 26 hours old, and there are 9 sources.*

```
GitHub repo (public: unlimited Actions minutes)
├── site/                               what gets deployed, nothing else
│   ├── index.html                      ← generated from templates/index.html; committed
│   ├── style.css  app.js  404.html  manifest.webmanifest  robots.txt
│   ├── news.json  feed.xml  feed.json  health.json   ← generated; committed when changed
│   ├── archive.json                    ← hand-written once
│   ├── font.woff2  og.png  favicon.svg  apple-touch-icon.png
│   ├── _headers  _redirects            ← served natively by Workers Static Assets
├── templates/index.html                the page with {{stream}}, {{hero}}, {{health}} slots
├── scripts/
│   ├── build-news.mjs                  fetch → parse → filter → dedupe → render → write
│   ├── check.mjs                       weekly self-check
│   └── lib/ (feeds.mjs, parse.mjs, filter.mjs, render.mjs)
├── tests/                              node --test; fixtures are saved sample feeds
├── feeds.json                          sources, tabs, keyword rules, Wii U flag
├── wrangler.jsonc                      { "name": "wiivolve", "assets": { "directory": "./site" } }
├── .github/workflows/site.yml          hourly build, weekly check, deploy on push
├── README.md  LICENSE (MIT for code; site content © Ali Kurnaz)
```

**The hourly job**
1. Fetch every source in parallel with a 15 s timeout, a descriptive User-Agent (`WiiVolveBot/1.0 (+https://wiivolve.com)`), and conditional requests where servers honor ETags. Each source is wrapped in try/catch and simply counts as "down" if it fails.
2. Parse RSS and Atom with a small hand-written extractor (titles, links, dates, descriptions, Atom `<link href>`, CDATA, entities). No npm packages, so nothing to update.
3. Filter, dedupe, carry over `firstSeen`, sort, trim. Derive the Dolphin release chip.
4. Render `index.html` from the template: the stream, the day groups, the hero line, the health line. Write `news.json`, `feed.xml`, `feed.json`, `health.json`.
5. If anything under `site/` changed, or if the last commit is more than a day old: commit as `wiivolve-bot` and push, then `npx wrangler@4 deploy`. Otherwise exit quietly.

**Data shapes**
```jsonc
// news.json and archive.json share one item shape
{ "generatedAt": "2026-11-04T16:17:00Z",
  "items": [{
    "id": "a3f9c1d2e4b5",            // hash of the canonical URL
    "title": "…", "url": "…",
    "source": "Nintendo Life", "sourceId": "nintendolife", "tab": "press",  // press | scene | archive
    "published": "2026-11-04T15:00:00Z", "firstSeen": "2026-11-04T15:17:00Z",
    "excerpt": "…", "matched": ["Wii", "WiiWare"]
  }] }
// health.json
{ "generatedAt": "…", "sources": [{ "id": "reddit-wii", "ok": false, "status": 429, "items": 0, "ms": 812, "lastOk": "2026-11-03T22:17:00Z" }] }
// feeds.json
{ "wiiU": false, "windowDays": 14, "minItems": 40, "maxItems": 40,
  "keywords": ["Wiimote", "Wii Remote", "…"],
  "sources": [{ "id": "nintendolife", "name": "Nintendo Life", "url": "https://www.nintendolife.com/feeds/latest", "tab": "press", "filter": "keywords" },
              { "id": "hackaday", "name": "Hackaday", "url": "https://hackaday.com/tag/wii/feed/", "tab": "scene", "filter": "none" }] }
```

**Workflow sketch (`site.yml`)**
```yaml
on:
  schedule: [{ cron: "17 * * * *" }, { cron: "0 9 * * 1" }]   # hourly build; Monday 09:00 UTC self-check
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: write, issues: write }
concurrency: { group: site, cancel-in-progress: false }
jobs:
  build:
    if: github.event.schedule != '0 9 * * 1'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node --test
      - run: node scripts/build-news.mjs
      - run: scripts/commit-if-changed.sh          # commits as wiivolve-bot, sets changed=true/false
      - if: steps.commit.outputs.changed == 'true'
        run: npx wrangler@4 deploy
        env: { CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}, CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }} }
  check:
    if: github.event.schedule == '0 9 * * 1'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/check.mjs                # opens or updates one GitHub issue only if something is broken
        env: { GH_TOKEN: ${{ github.token }} }
```

**The weekly self-check (`check.mjs`)**
- Every source: has it succeeded in the last 7 days (`lastOk` in `health.json`)? If not, it is "down".
- Every link in `archive.json` and every snapshot link in the About panel: does Wayback answer 200?
- The live site: does `https://wiivolve.com/` return 200 with a `generatedAt` less than 3 hours old?
- The feeds: do `feed.xml` and `feed.json` parse?
- If anything fails, open one GitHub issue labeled `site-check` (or add a comment to the open one). If all is well, do nothing. GitHub emails you the issue. That is the only way the site ever asks for attention.

**Why this shape**
- Static-asset requests on Workers are free and unlimited, and with no Worker script there is no request quota, no CPU limit, nothing to fail.
- Pre-rendering at build time means the page is complete HTML: it reads without JavaScript, crawlers see the content, and the first paint is the content.
- GitHub runners have no CPU ceiling; the Workers free plan caps Cron Triggers at 10 ms CPU per run, which a dozen feed parses can exceed. GitHub also emails you if a run fails outright.
- The daily commit guarantee matters: GitHub automatically disables scheduled workflows in a public repository after 60 days without repository activity. The job's own commits count as activity, so the schedule never pauses.
- Pushes made with the job's token do not trigger another run, so there is no loop; the deploy happens inside the same job.
- Deploying from the job means hourly refreshes cost no Workers Builds minutes.
- Secrets: `CLOUDFLARE_API_TOKEN` (Workers edit scope, this account only) and `CLOUDFLARE_ACCOUNT_ID`. Pin actions by major tag and `wrangler@4` by major, so patch releases arrive on their own and nothing needs a pull request.

**Headers and redirects**
```
# _headers
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; font-src 'self'; base-uri 'none'; frame-ancestors 'none'
/news.json
  Cache-Control: public, max-age=300
/feed.xml
  Cache-Control: public, max-age=900
/font.woff2
  Cache-Control: public, max-age=31536000, immutable
```
```
# _redirects
/rss.php    /feed.xml   301
/index.php  /           301
/www/*      /           301
```
`www.wiivolve.com` to `wiivolve.com` is a one-time Redirect Rule in the Cloudflare dashboard (free), since `_redirects` matches paths, not hosts.

**Failure modes, all harmless:** a feed dies, the health line drops to 8 of 9 and, after a week, one issue appears. The job fails, the site keeps the last deploy. The token is revoked, same. Wayback is down, archive links fail until it is back. Cloudflare changes free limits, the site is static assets and would be the last thing affected.

**Alternatives considered:** Cloudflare Pages (same output, same work, fewer features going forward; Cloudflare's docs point new projects at Workers). An all-Cloudflare Worker with a Cron Trigger and KV (free, but the 10 ms CPU limit makes feed parsing fragile on the free plan).

---

## 8. Quality bar

**Accessibility (WCAG 2.2 AA)**
- Skip link, landmarks (`header`, `main`, `nav`, `footer`), one `h1`, headings in order, a real `<ul>` for the stream.
- Text contrast 4.5:1 or better in both themes; slot blue is never body text. "New" is a word as well as a color.
- Everything works by keyboard: visible focus rings, filters as real buttons with `aria-pressed`, search results announced through an `aria-live` count, the About panel closes on Escape, the console is a button with a label ("Jump to the newest item").
- Touch targets 44px, no hover-only information, `prefers-reduced-motion` turns off all motion including the glow pulse.
- The glow has a text equivalent ("7 new since your last visit").

**Performance**
- Budget: HTML under 40 KB, CSS under 12 KB, JS under 8 KB, font under 40 KB, no images on the page. Lighthouse 100 on all four scores; LCP under 1 s on 4G.
- `content-visibility: auto` on stream sections; font preloaded; `_headers` caching; no third-party requests other than optional Cloudflare Web Analytics.

**SEO and sharing**
- Canonical URL, title and description, OpenGraph and Twitter card tags, a 1200×630 `og.png` of the console and wordmark, `WebSite` JSON-LD, `robots.txt` allowing all, `<link rel="alternate">` for both feeds.

**Security and privacy**
- The `_headers` set above; HTTPS automatic on Cloudflare; no cookies, no forms, no inline scripts (CSP has no `unsafe-inline`).
- Cloudflare Web Analytics is on by default: free, cookieless, one script, and the only way to know the site is being read. Turn it off by deleting one line.

**Testing**
- `node --test` runs on every build before anything is written: the parser against saved fixture feeds (one per source, captured during M2), the filter rules against a table of titles that must pass and must fail, the dedupe, the excerpt trimmer, the renderer against a snapshot.
- A pull request to `main` runs the same tests and a dry build; `wrangler deploy` only runs from `main`.

---

## 9. Build plan and launch checklist

| Milestone | Scope | Effort |
|---|---|---|
| M1 Skeleton live | Repo, `wrangler.jsonc`, template, hero, stream with placeholder data, light and dark tokens, About panel, 404, favicons, `_headers`, deploy to `workers.dev`, attach wiivolve.com | one day |
| M2 Engine | `build-news.mjs` and lib, `feeds.json`, tests with fixtures, pre-render, feeds, `health.json`, `check.mjs`, the workflow with commit-if-changed and deploy, a week of filter tuning on real runs | one day |
| M3 Deep end and launch | Divider copy, `archive.json`, OG image, redirects and the old-link bounce, print stylesheet, analytics, checklist below, go live on November 19 | half a day |

**Launch checklist**
- [ ] `wiivolve.com` attached to the Worker as a Custom Domain; `www.wiivolve.com` a proxied placeholder record plus a Redirect Rule to the apex; the 523 is gone.
- [ ] Namecheap auto-renew on (expires 2027-11-01).
- [ ] Both secrets set; a manual `workflow_dispatch` run deploys; the hourly run has committed at least once.
- [ ] Feeds validate; `feed.xml` opens in a reader.
- [ ] Old-link bounce tested with a real 2007 URL from a forum post.
- [ ] Phone check in Safari and Chrome, both themes, reduced motion on.
- [ ] Lighthouse 100/100/100/100.
- [ ] Share preview checked with the OG debugger of your choice.
- [ ] Analytics shows the first visit.

---

## 10. Operations after launch

- **Nothing on a schedule.** The job runs hourly and the check runs weekly on their own.
- **You hear from the site only through GitHub:** a `site-check` issue when the Monday check finds a problem (a source counts only after a week down), or a failed-run email if the job itself cannot complete. Both are rare.
- **Once a year:** the domain renews (auto-renew on). That is the only human task.
- **If the list looks off:** the fix is a keyword or a flag in `feeds.json`, a push, and the next hourly run.
- **If a source dies for good:** delete its line in `feeds.json`.

---

## 11. Decisions (defaults chosen; change any)

| Decision | Default | Alternative |
|---|---|---|
| Wii U news | Off, one flag in `feeds.json` | On, as part of Press |
| Reddit sources | Include, best effort | Drop to avoid flakiness |
| Repo visibility | Public (free unlimited Actions minutes; the code is part of the tribute) | Private (2,000 minutes/month, still plenty) |
| Display font | Bricolage Grotesque, self-hosted | System UI only, zero font files |
| Dark mode | Automatic from the system setting | Light only |
| Analytics | Cloudflare Web Analytics on | None |
| Contact | GitHub issues only | A dedicated address via Cloudflare Email Routing |
| The 2009 header art | A small artifact in the divider | Not shown |

---

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Reddit blocks GitHub runner IPs | Medium | Best-effort source; the stream has seven others; the check only reports after a week down |
| Google News changes its RSS format | Low | Parser tests catch it; drop the source with one line if needed |
| A publisher changes feed URLs | Low | Weekly check files an issue; edit one line |
| GitHub changes free Actions minutes for public repos | Low | Hourly runs are about 30 s; private-repo minutes would still cover it |
| Nintendo trademark complaint | Very low | Disclaimer, no Nintendo artwork, no re-hosted assets; a fan news site is ordinary |
| The build commits too often and clutters history | Certain, harmless | Commits are squashed in the mind by `git log -- scripts`; data history is a feature |

---

## 13. Parked (none needed for launch)
- Full harvest of every 2006–2008 headline from the monthly captures into the stream.
- A short "still using your Wii in 2026" link list (Wiimmfi, WiiLink, wii.hacks.guide, Dolphin), link-checked weekly like the rest.
- A "today in Wii history" strip from a curated date list.
- A true Direct2Wii over RiiConnect24's revived Wii mail.
- A "share your Wii memory" wall via GitHub Discussions.
- The teal skin (July 2007 to 2014, best captured in 2009) as an alternate theme.
