# WiiVolve

**Wii news, still spinning since 2006.** <https://wiivolve.com>

WiiVolve was a Nintendo Wii news site from 2006 to 2008, run by a group of high-school students. In 2026 it is back as a single page that gathers Wii news and homebrew scene activity from around the web every hour, removes duplicates and links you to the source. Below today's news the page runs back in time to the original site's own 2006 to 2008 headlines, ending with the August 2006 "coming soon" page where it all started. Old wiivolve.com links from forums still work: they land on the best archived copy of the page.

Nobody edits the list by hand. A GitHub Actions job rebuilds the page every hour and deploys it to Cloudflare only when something changed, and a weekly self-check opens a GitHub issue when something needs a person: the live page, a feed or an archive link is broken, `health.json` is more than 26 hours old, or a source has been down for more than a week. Otherwise it never speaks.

## How it works

```
  feeds.json: 9 RSS and Atom sources, keywords, rules
        |
        v                                   every hour at :17, on GitHub Actions
  scripts/build-news.mjs  fetch -> parse -> keep what is about the original Wii
        |                 -> remove duplicates -> select -> render (no JavaScript needed)
        |
        +--> site/index.html     the pre-rendered page (from templates/index.html)
        +--> site/news.json      the items, for the page's search and filters
        +--> site/feed.xml       RSS 2.0
        +--> site/feed.json      JSON Feed 1.1
        +--> site/health.json    how each source did
        +--> state/state.json    the builder's memory (committed, never deployed)
        |
   changed? --no--> nothing to commit; deploy again only if the live site is
        |           behind the committed one (a deploy that failed)
       yes          (a new story, an edit, a new UTC day, or a source failing:
        |            each of its first three failures and its recovery count)
        v
  scripts/commit-if-changed.sh   commit the six generated files as github-actions[bot] and push
        |
        v
  npx wrangler@4.157.0 deploy -->  Cloudflare Workers Static Assets  ---->  https://wiivolve.com
                                 no Worker script, just the files in site/
                                 site/_headers   security headers, caching
                                 site/_redirects old .php links -> web.archive.org
                                 site/404.js     old article, game and cheat links -> their
                                                 best capture (site/legacy-map.json)

  Mondays 09:00 UTC: scripts/check.mjs checks the live page, health.json, every
  web.archive.org link and both feeds, and opens, updates or closes one GitHub
  issue labelled "site-check". That issue is the only way the site asks for help.
```

The build changes at least once a day (the page carries the date and the Wii's age), so the repository always has activity and GitHub never pauses the hourly schedule. Pushes made by the job do not start another run, so there are no loops. Everything is plain Node with no npm dependencies, so there is nothing to update except two deliberate pins: the wrangler version and the Node version CI uses (ARCHITECTURE 1.3; RUNBOOK, "Doing things by hand").

The full contract (data shapes, rules, page behaviour) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the why is in [PLAN.md](PLAN.md). One-time setup and what to do when something breaks are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Run it locally

You need Node 22 or later. There is nothing to install.

| Command | What it does |
| --- | --- |
| `npm test` | Every test (`node --test`), offline. CI runs this before every build. |
| `npm run build` | Fetches the real feeds and rewrites the generated files in `site/` and `state/`. They are tracked files: undo it with `git restore site state` before your next `git pull` (see "Changing what the page shows"). |
| `npm run build:offline` | A preview build from the saved feeds in `tests/fixtures/`, without network, written to `work/offline/` (git-ignored), so `site/` and `state/` stay as the bot committed them. |
| `npm run serve:offline` | Serves that preview at <http://127.0.0.1:8788>. |
| `npm run serve` | Serves `site/` at <http://127.0.0.1:8788> with the headers, redirects, caching and 404 page that Cloudflare applies (checked against `wrangler dev` by `tests/serve.test.mjs`). |
| `npm run preview` | Serves `site/` with Cloudflare's own local runtime (`wrangler dev` 4.157.0, downloaded on first use). The reference when you change `site/_redirects` or `site/_headers`. |
| `npm run legacy-map` | Rebuilds `site/legacy-map.json` (old article, game and cheat links → their best Wayback capture, and each endpoint's list page) from `legacy-assets/headlines-full.json` and `legacy-assets/wayback-url-index.json`. |
| `npm run qa` | Static contract checks plus a set of screenshots in `work/shots/` (needs Google Chrome). |
| `npm run check` | The weekly self-check against the live site. Prints a report; exits 1 if something is wrong. |
| `npm run deploy` | Deploys `site/` by hand (after `npx wrangler@4 login`). Normally CI does this; see RUNBOOK, "Doing things by hand", before you use it. |
| `npm run icons` | Re-renders the icons, `favicon.ico` and the share image (`site/*.png`, `site/favicon.*`) from `assets-src/` with headless Chrome, and shrinks the PNGs when ffmpeg is installed. Only needed after changing the console's look or the favicon. |

Useful flags for `node scripts/build-news.mjs` (all of them are in ARCHITECTURE section 5): `--offline`, `--force` (write even when nothing changed), `--now 2026-11-19T15:00:00Z` (pretend it is another time), `--quiet`. The page also accepts `?now=<ISO date>` in the address bar to preview another day, for example the birthday mode (party hat and all) with `?now=2026-11-19T15:00:00Z`. A preview like that never touches the page's memory of your last visit.

`npm run check -- --url http://127.0.0.1:8788` checks a local copy instead of the live site. CI commits the generated files; never commit them yourself (see below).

## Changing what the page shows: `feeds.json`

Every rule lives in [`feeds.json`](feeds.json). The bot commits to `main` every day, so always start from its latest commit, and commit only the file you changed:

```sh
git pull --rebase                 # the bot's latest news and state
# edit feeds.json
npm test                          # the tests use their own frozen copy, so this checks the code, not your edit
npm run build:offline && npm run serve:offline   # preview at http://127.0.0.1:8788 (optional)
git add feeds.json && git commit -m "Tune keywords" && git push
```

The push starts a build that deploys within a few minutes. If the push is rejected because the bot pushed in the meantime, run `git pull --rebase` and push again. Never `git add -A` after `npm run build`: that would commit outputs built on your Mac over the bot's (undo the build with `git restore site state`). A change to keywords, exclusions, `wiiU` or a source's filter also re-checks the stories already on the page at the next build: one that no longer passes leaves, also when its source happens to be down that hour. To remove one particular story for good, add an `exclude` pattern for its title.

### Add a source

1. Open the feed URL in a browser to make sure it is a working RSS or Atom feed.
2. Add one entry to `sources`:

   ```json
   { "id": "example", "name": "Example News", "tab": "press", "filter": "keywords", "priority": 2,
     "url": "https://example.com/feed/", "homepage": "https://example.com" }
   ```

   | Field | Meaning |
   | --- | --- |
   | `id` | Short unique name, lowercase. The builder remembers sources by it, so do not change it later. |
   | `name` | Shown on the page next to each story. |
   | `tab` | `press` (news sites) or `scene` (homebrew, emulation, communities). |
   | `filter` | `keywords` keeps only stories about the Wii (the title matches, or the text mentions at least two keywords). `none` keeps everything, for feeds that are already only about the Wii. |
   | `priority` | Which copy wins when two sources carry the same story: higher wins. Publishers 2, communities 1, aggregators 0. |
   | `url`, `homepage` | The feed, and the page the About panel links to. |
   | optional | `"aggregator": true` (like Google News), `"userAgent": "..."` (this source's own User-Agent; Reddit gets a descriptive one, as its rules ask; `"browser"` sends a desktop Chrome UA, for sites that only block bots), `"maxItems": 10` (per-source cap), `"strip": ["regex", ...]` (boilerplate to cut from excerpts). |

3. Optional, for offline previews of a brand-new source only: save its feed as `tests/fixtures/<id>.xml` (`curl -sL "https://example.com/feed/" -o tests/fixtures/example.xml`). Never overwrite, refresh or delete the files already in `tests/fixtures/`: they are the tests' own frozen data.
4. Push.

### Remove a source

Delete its entry from `sources` and push. Leave `tests/fixtures/` alone (the tests use their own copy of the original sources). Its stories leave the page on the next build and the status line counts one source fewer.

### Keywords and exclusions

* `keywords`: words and phrases that make a story count as Wii news. Matching ignores case and only matches whole words. `Wii` itself never matches "Wii U" unless you set `"wiiU": true`.
* `exclude`: titles to drop from every source, written as case-insensitive regular expressions, for example `"megathread"`. In JSON a backslash is written twice (`"\\?"`). It is always a list, even with one pattern (`["megathread"]`); a wrong type stops the build instead of emptying the page.
* `selection`: how many days count as fresh (`windowDays`), the fewest stories to show (`minItems`, topped up with older ones), the oldest story allowed (`maxAgeDays`), the caps (`maxItems`, `maxPerSource`), and two floors: every source shows at least its newest `minPerSource` stories and each tab at least `minPerTab`, from older stories if the last two weeks hold fewer (so a busy week of Reddit posts never pushes Dolphin, Hackaday or the Press tab off the page). Below the fresh window the page says "Further back: a few picks per source." and writes no quiet gaps there, since that part is a selection.
* `site`: the address, name and texts of the site. `repo` stays `null`; CI fills in the GitHub link.

## Where things live

| Part | Files |
| --- | --- |
| Design | The concept is [PLAN.md](PLAN.md) section 4; the as-built behaviour is ARCHITECTURE section 6. The page is `templates/index.html` (template), `scripts/lib/render.mjs` (fills it), `site/style.css`, `site/app.js` (enhancements only), `site/print.css` and `site/party.css` (printing, and the November 19 birthday kit), `site/404.html` with `404.css` and `404.js` ("No disc inserted." and the old-link bounce), `site/fonts/` (after changing the font, run `node tools/font-coverage.mjs` and paste its line into `DISPLAY_COVERAGE` in `render.mjs`), `site/legacy/` (the teal-era header artifact, captured in 2009) and the icons in `site/`, rendered from `assets-src/`. Screenshots: `tools/shoot.mjs`, `tools/qa.mjs`. |
| The original site | `site/archive.json` (hand-picked 2006 to 2008 headlines), `site/legacy-map.json` (generated by `npm run legacy-map`: every documented old article and its best capture) and `legacy-assets/` (recovered material, not deployed). |
| Engine | `scripts/build-news.mjs` and `scripts/lib/` (fetch, parse, text, filter, select, feeds, util). Tests in `tests/`; their frozen inputs (saved feeds and a copy of the launch `feeds.json`) in `tests/fixtures/`. |
| Automation | `.github/workflows/site.yml`, `scripts/commit-if-changed.sh`, `scripts/check.mjs`. |
| Hosting | `wrangler.jsonc`, `site/_headers`, `site/_redirects`, `site/.assetsignore`, `site/robots.txt`, `site/sitemap.xml`, `site/manifest.webmanifest`. |
| Docs | [PLAN.md](PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/RUNBOOK.md](docs/RUNBOOK.md). |

## Credits

* **The original WiiVolve** (2006 to 2008) by Ali Kurnaz and friends. Its pages survive thanks to the Internet Archive's [Wayback Machine](https://web.archive.org/web/*/wiivolve.com), which every archive link on the page points to.
* **Bricolage Grotesque**, the display typeface, by The Bricolage Grotesque Project Authors ([github.com/ateliertriay/bricolage](https://github.com/ateliertriay/bricolage)), used under the SIL Open Font License 1.1 ([site/fonts/OFL.txt](site/fonts/OFL.txt)).
* **The news** belongs to the sites it links to: Nintendo Life, GoNintendo, Nintendo Everything, Time Extension, the publishers found through Google News, Hackaday, the Dolphin Emulator blog, r/wii and r/WiiHacks.
* Hosted on Cloudflare Workers, built by GitHub Actions.

WiiVolve is not affiliated with or endorsed by Nintendo. Wii is a trademark of Nintendo.

## License

The code is MIT licensed. The site's own text is © 2026 Ali Kurnaz; the original 2006 to 2008 material stays with the WiiVolve staff who wrote it; the saved test feeds belong to their publishers; the font is under the SIL Open Font License. See [LICENSE](LICENSE).
