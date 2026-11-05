# WiiVolve: the facts behind the copy

Evidence for every number and claim in `docs/ARCHITECTURE.md` section 10 (the deep end, the stats row, the quote, the five archive snapshot links), with corrections where the copy is wrong or imprecise. Reference only; not deployed.

Checked on 2026-11-04 against the Internet Archive:

- the CDX API (homepage: `https://web.archive.org/cdx/search/cdx?url=wiivolve.com&output=json&fl=timestamp,original,statuscode`; whole domain: the same with `&matchType=domain`);
- 167 raw captures (`https://web.archive.org/web/<timestamp>id_/<url>`): every distinct homepage capture from 2006-11 through 2009, every `index.php` capture, every News Archive (`news.php`) capture through 2009, one capture of every archived post, feature, review and preview, the list pages, and the About, Staff, Statistics and Direct2Wii pages;
- each link below opened in a real browser (Chromium) to see what a reader actually gets.

Wayback links below use the form `https://web.archive.org/web/<timestamp>/http://wiivolve.com/...`. Every one was fetched and returned HTTP 200 after following redirects.

---

## Summary

| Copy (section 10) | Verdict | Suggested wording |
|---|---|---|
| 260+ posts | **Overstated.** 267 is the post-ID counter, not a count. 220 posts are documented. | **220 posts** (or "220+ posts") |
| ~105 articles | **Overstated.** 105 is the article-ID counter. 69 are documented, and the site's own statistics show the counter ran far ahead of the real count. | **~70 articles** (or exactly "40 reviews") |
| ~200 games | **Understated.** The game database reached ID 268, and its IDs tracked the real count closely. | **260+ games** |
| 144 archive captures | **Correct.** The Wayback calendar itself says "Saved 144 times". | keep |
| From 2006 to 2008 | Correct | keep |
| covered the Wii almost every day | **Overstated.** True only in launch month (posts on 26 of 30 days in Nov 2006). Over the whole run, posts went up on 39% of days. | "covered the Wii several times a week, almost daily around launch," |
| run by a few high-school students after class | **Imprecise.** "High-school students" is right (the site says so twice). "A few" understates a staff page of 10 names. Nothing in the archive says "after class". | "run by a group of high-school students" |
| news, reviews, previews, cheats, and Direct2Wii, a newsletter delivered to the console itself | Correct | keep |
| The last post, in March 2008, promised a reconstruction. | Correct | keep |
| Quote: "…a group of unpaid high school students in the middle of their school years." | Correct, verbatim | keep |
| Eighteen quiet years. | Correct (March 2008 to November 2026 is 18 years and 8 months) | keep |
| Five snapshot links | All return 200 and show what they claim, with two caveats: the coming-soon page's artwork was never archived, and the teal era started in July 2007, not 2009 | see section 5 |

Suggested stats row: **220 posts · ~70 articles · 260+ games · 144 archive captures**

Suggested deep-end body: "From 2006 to 2008, WiiVolve covered the Wii several times a week, almost daily around launch, run by a group of high-school students: news, reviews, previews, cheats, and Direct2Wii, a newsletter delivered to the console itself. The last post, in March 2008, promised a reconstruction. This is it."

---

## 1. The best single source: the site's own Statistics page

`stats.php`, captured 2007-02-16, is the only place the site counted itself:

> Statistics · News Total: 169 · Games Total: 140 · Articles Total: 42 · Screenshots Total: 526 · Cheats Total: 35

Source: https://web.archive.org/web/20070216062838/http://wiivolve.com/stats.php

This page lets us test whether the ID numbers in URLs are counts. On the same week:

| | Real total (stats.php, 2007-02-16) | Highest ID in use that week | IDs a good proxy? |
|---|---|---|---|
| News | 169 | 192 (`newsId=192`, posted 2007-02-14) | No, the counter ran ~14% ahead |
| Games | 140 | 142 (Latest Games list, 2007-02-12) | **Yes**, almost one to one |
| Articles | 42 | ~73 (`articleId=71` preview 2007-02-11; `74` review 2007-02-18) | **No**, the counter ran ~75% ahead |

Sources: News Archive 2007-02-12 https://web.archive.org/web/20070212133929/http://wiivolve.com/news.php?system=Wii · games list 2007-02-12 https://web.archive.org/web/20070212133940/http://wiivolve.com/games.php?system=Wii

## 2. The stats row

### "260+ posts" → 220 posts

- The post-ID counter reached **267**, the "WiiVolve Reconstruction Plan" (https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267). That is where "260+" came from.
- The site's own News Archive lists **219 posts**, from newsId 6, "Welcome to WiiVolve.com!" (September 13, 2006), to newsId 267 (March 1, 2008): https://web.archive.org/web/20100616002716/http://wiivolve.com/news.php?system=Wii. The February 2008 capture lists 218, ending at newsId 266: https://web.archive.org/web/20080208231423/http://wiivolve.com/news.php?system=Wii
- One more post was captured directly but later dropped from the list: newsId 20, "Dolby Confirms Pro Logic II for Wii", September 23, 2006 (https://web.archive.org/web/20070928155719/http://wiivolve.com/fullNews.php?newsId=20).
- **Total documented: 220 distinct posts** (all in `headlines-full.json`, kind `post`). 47 of the IDs 1 to 267 never appear anywhere (1–5, then 42 scattered gaps), most likely test posts, deletions or posts belonging to sister XiiNet sites in the same database.
- The Statistics page counted 169 when only about 152 public posts existed, so the database may have held a few more than 220. Either way, nowhere near 260.

### "~105 articles" → ~70 articles

- Features, reviews and previews share one `articleId` sequence. The highest is **105**, the review "Paper Mario*" from August 25, 2007 (https://web.archive.org/web/20071011053024/http://wiivolve.com/review.php?articleId=105&page=1). The asterisk is the site's own Virtual Console marker.
- Documented: **69 articles**, made up of:
  - **40 reviews.** This is the complete A–Z list from January 29, 2008: https://web.archive.org/web/20080129225758/http://wiivolve.com/reviews.php?alpha=all&system=
  - **21 features**, from the feature lists of February 2007 and February 2008 (which overlap, so the run is complete from ID 10 up): https://web.archive.org/web/20070212134203/http://wiivolve.com/articles.php?system=Wii · https://web.archive.org/web/20080208231355/http://wiivolve.com/articles.php?system=Wii
  - **8 previews**: https://web.archive.org/web/20080208231436/http://wiivolve.com/previews.php?system=Wii
- Cross-check: the captures account for 41 articles with IDs up to 73, against the site's own "Articles Total: 42" that week. The documented set is therefore essentially complete, and the real final total is about 70.

### "~200 games" → 260+ games

- The "about 200" in PLAN.md came from the highest `gameId` in the captured-URL index (`cheat.php?gameId=208`).
- The game database's own "Latest Games" list ran to **gameId 268** ("GALAGA '90*") by September 4, 2007 and was unchanged on February 8, 2008. The list shows IDs 254–268 in sequence, many of them Virtual Console titles: https://web.archive.org/web/20080208231410/http://wiivolve.com/games.php?system=Wii
- Game IDs tracked the real count almost exactly (140 games at ID 142 in February 2007, see section 1). That makes **roughly 265 games** the best estimate. No complete A–Z game list was archived, so treat it as an estimate: "260+".

### "144 archive captures" → correct

- The Wayback calendar says: "Saved **144** times between August 26, 2006 and July 14, 2025." (https://web.archive.org/web/*/wiivolve.com)
- The CDX API returns 144 homepage rows. Fine print: those rows cover 139 distinct timestamps. Four moments were recorded more than once, three of them in 2024–2025 over both http and https. Statuses are 117 × 200, 5 × 301, 5 × 302, 4 × 403, 6 × 523, and 7 with no status. The last capture that shows the WiiVolve site is 2014-01-18. After that come redirects, 403s, a small non-WiiVolve page in 2016 (cPanel's `defaultwebpage.cgi` was captured that March), and Cloudflare 523s (2024–2025).
- Across the whole domain there are 2,412 captures of all file types. `wayback-url-index.json` lists 400 distinct URLs.

## 3. The deep-end body

**"From 2006 to 2008"** is correct. The coming-soon page was first captured August 26, 2006. The first post, "Welcome to WiiVolve.com!", went up September 13, 2006. The last regular post, "New Nintendo Trademarks Hint at Future", went up September 4, 2007, and the final post on March 1, 2008.

**"covered the Wii almost every day"** is overstated.

- 220 posts went up on 140 distinct days.
- From the first post to the last regular one (2006-09-13 to 2007-09-04): 219 posts on **139 of 357 days (39%)**.
- Only launch month fits the phrase: **November 2006 had 63 posts on 26 of 30 days**.
- Posting days per month: Sep 2006 6, Oct 13, **Nov 26**, Dec 15, Jan 2007 16, Feb 12, Mar 7, Apr 8, **May 0**, Jun 13, Jul 13, Aug 9, Sep 1.
- Two long silences:
  - April 18 to June 7, 2007, when the site closed for final exams (see below);
  - September 4, 2007 to March 1, 2008, when the site was down. The Reconstruction Plan opens with "the website has been down for quite some time".
- The site did promise "authentic Wii content daily" on its About Us page: https://web.archive.org/web/20070212133918/http://wiivolve.com/aboutus.php

**"run by a few high-school students after class"** is right on students, wrong on "a few", and "after class" is an inference.

- Reconstruction Plan, March 1, 2008: "a group of unpaid high school students in the middle of their school years" (https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267).
- "WiiVolve is Back on Track", June 7, 2007, explains the spring closure: the staff "had our noses stuck to textbooks, studying for our final exams" (https://web.archive.org/web/20070614103113/http://wiivolve.com/fullNews.php?newsId=213).
- The Staff page of February 12, 2007 lists **10 people**: Ali (founding webmaster), Phil (temporary leader), Kevin and Lorenzo (editors), Giovanni (news), Isaac (articles), Semih (cheats), Joe (media), Aldo and Greg (tech team). https://web.archive.org/web/20070212133639/http://wiivolve.com/staff.php
- By September 4, 2007 the page lists 9: Ali; Phil and Matt (Xiin network founders); Kevin and Semih (editors); Chang and Krystal (articles); Aldo and Greg (tech). https://web.archive.org/web/20070904095225/http://wiivolve.com/staff.php
- Bylines on the 64 captured post and article pages that show one: Ali 33, Kevin 20, Krystal 4, Isaac 3, Chang 2, Elliott 1, Lorenzo 1.
- No page says the work happened "after class". "A group of high-school students" is the site's own wording.

**"news, reviews, previews, cheats"** is correct. The 2007 menu reads: Home, News Archive, Game Database, Features, Reviews, Previews, Screenshots, Cheat Codes, then Message Boards, Wi-Fi Station, Direct2Wii, Mail Bag, Downloads, Contests, Contact Us. https://web.archive.org/web/20070703152325/http://wiivolve.com/

**"Direct2Wii, a newsletter delivered to the console itself"** is correct. From the Direct2Wii page (https://web.archive.org/web/20070212133610/http://wiivolve.com/d2w.php), headed "Direct2Wii Newsletter":

- "D2W stands for Direct2Wii. It is WiiVolve's news-delivery service to those who have an internet connection on their Wii consoles."
- WiiVolve would "periodically send you important headlines".
- It sent text-only email ("This excludes images, Flash, and other multimedia").
- It needed WiiConnect24. Readers registered their 16-digit Wii Number and added `news@wiivolve.com` to the console's address book. Sign-up form: https://web.archive.org/web/20070217065444/http://wiivolve.com/d2w_subscribe.php

The blue glow of the disc slot when mail arrived is how the Wii itself behaved with WiiConnect24 messages. That is general knowledge; no WiiVolve page says it.

**"The last post, in March 2008, promised a reconstruction."** is correct. "WiiVolve Reconstruction Plan", March 1, 2008 @ 13:12 (server time, time zone unknown), by Ali. It promised to relaunch WiiVolve as a reviews-only site with Editors' and Users' reviews and "a brighter" layout. It never shipped. The homepage first shows the post in the March 11, 2008 capture: https://web.archive.org/web/20080311101945/http://wiivolve.com/index.php?

## 4. The quote

"…a group of unpaid high school students in the middle of their school years." — WiiVolve Reconstruction Plan, March 1, 2008.

Verbatim. The full sentence is "We have come to the conclusion that it takes too much effort to maintain this, especially for a group of unpaid high school students in the middle of their school years." Source: https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267

## 5. The five snapshot links

All five were fetched on 2026-11-04 (HTTP 200 after redirects) and opened in a browser.

1. **2007 heyday**: https://web.archive.org/web/20070703152325/http://wiivolve.com/
   - 200, no redirect.
   - Shows the full homepage for "Tuesday, July 3, 2007": ten news items (June 18–29, 2007), Featured Articles, a poll, and the Latest Previews, Reviews, Features and Cheats docks.
   - Caveat: the header image is missing, and Wayback fills in the nearest archived skin images, so the date bar renders black.
   - This is the last capture of the light 2007 skin; the dark skin was live by July 7.
2. **Coming-soon page**: https://web.archive.org/web/20060826001626/http://wiivolve.com/
   - 200, no redirect. Page title "WiiVolve.com | Your Number One Source for Wii News!".
   - **Caveat: the coming-soon artwork was never archived** (the page is 23 image slices, `images/wiivolvecomingsoon_*.gif`, with no captures). A reader sees a grey page of broken images with alt-text links ("Read our history!", "WiiVolve Boards, hosted by Xiin Boards", "XiiNet", "Sneak peak!", "WiiMail", "DynaTech Media") and the 2006 footer, which begins "WiiVolve.com © Ali Kurnaz 2006. All rights reserved." and ends "An extension of XiiNet."
   - The words "NEW SITE COMING SOON" survive only in an HTML comment around the image table.
   - The label is accurate; the page just looks broken. Consider saying "artwork not archived" next to the link.
3. **The last post**: https://web.archive.org/web/20110509/http://wiivolve.com/fullNews.php?newsId=267
   - The partial timestamp redirects to https://web.archive.org/web/20110509235246/http://wiivolve.com/fullNews.php?newsId=267 (200), which shows the Reconstruction Plan in the dark teal skin.
   - Suggest linking the full timestamp to skip the redirect.
4. **The teal era**: https://web.archive.org/web/20090802061250/http://wiivolve.com/
   - 200, no redirect. Shows the fully rendered black-and-teal skin with the 2009 header wordmark; the news list is topped by the Reconstruction Plan.
   - **Correction to PLAN.md:** the teal era began in **July 2007**, not 2009.
     - The July 3, 2007 homepage uses the light skin.
     - The July 7, 2007 homepage links its stylesheet with `title="dark"` (https://web.archive.org/web/20070707044933/http://wiivolve.com/index.php?).
     - From July 12, 2007 the pages colour their ad links `#00ccc9`, the teal of the 2009 stylesheet (`legacy-assets/skin-2009/style.css`).
     - In March 2008 the Reconstruction Plan speaks of "popular demand to change our dark appearance".
   - The 2009 capture is still the best-rendered example and fine to link.
5. **Every capture**: https://web.archive.org/web/*/wiivolve.com
   - 200. In a browser it lands on the current-year calendar (`/web/20260000000000*/wiivolve.com`, empty for 2026) under the line "Saved 144 times between August 26, 2006 and July 14, 2025."
   - Optional: https://web.archive.org/web/2007*/wiivolve.com opens on the heyday year instead.

## 6. Other facts the page relies on

- **Wii launch, November 19, 2006** (drives the age counter and birthday mode). WiiVolve said it at the time: "…to deliver Wii to retailers' shelves for the November 19 launch" ("First Wii from UPS Delivered", November 15, 2006). https://web.archive.org/web/20061117083800/http://wiivolve.com/index.php?system=Wii
- **© Ali Kurnaz since 2006**: the coming-soon footer reads "WiiVolve.com © Ali Kurnaz 2006." Footers from 2007 and 2008 read "© 2007 Ali Kurnaz" and "© 2008 Ali Kurnaz".
- **Old taglines**: "Your Number One Source for Wii News!" (2006 coming-soon title) and "WiiVolve: WiiVolving Around You" (page title from November 2006 on).
- **"WiiVolve is an extension of XiiNet"**: in every 2007–2009 footer.

## 7. Further corrections to PLAN.md section 1 (for the record)

- **The 2006-11-07 splash** (title "Detecting Browser... Please Wait.") sent Firefox to `index.php?system=Wii`, Internet Explorer to `browser/ie.html`, Netscape to `browser/ne.html`, Opera to `browser/op.html`, and everything else to `browser/un.html`. Only the IE and Netscape pages were archived. **Opened in Chrome, Safari or Edge today, the archived splash forwards to a Wayback "not archived" error**, which is why `archive.json` links the archived IE page instead. Later versions (from November 27, 2006) point to `.php` pages and add a "Continue." link.
- **Where the homepage lived.** Most of the time the real front page was `index.php?system=Wii` / `index.php?`, and the bare domain showed something else. The bare-domain captures show, in order:

  | Period | What the bare domain served |
  |---|---|
  | 2006-08-26 | the coming-soon page |
  | 2006-11 to 2007-01 | the browser check |
  | 2007-05-21 | a splash image |
  | 2007-06-14 and 2007-07-03 | the full homepage |
  | 2007-07-05 | a black XiiNet notice |
  | 2007-08-23 to 2007-09-04 | the browser check again |
  | 2007-10-11 to 2008-02-23 | a black "reform" page (`images/reform.png` and "Click here to continue on to WiiVolve."): https://web.archive.org/web/20071011020248/http://wiivolve.com/ |
  | 2008-03-25 | the browser check |
  | 2008-04-30 to 2009-03-28 | a frameset loading `http://www.mysticfox.info/wiivolve`: https://web.archive.org/web/20080430075651/http://wiivolve.com/ |
  | 2009-04-28 to 2014-01-18 | the frozen dark homepage again (two captures in Sept–Oct 2009 are redirects to 404 pages) |
- **The site was not daily through summer 2007.** Nothing was posted from April 18 to June 7, 2007 (the exam closure), and regular news ended September 4, 2007.
- **Cheats**: the site counted 35 cheat entries on 2007-02-16, and the cheat numbers on the homepage reach #66 by 2007-07-03 (`cheat.php?gameId=134#66`). PLAN.md's "about 40" was low by summer 2007.
- **Screenshots**: 526 on 2007-02-16; screenshot file numbers reach 836 by August 2007.

## 8. `site/archive.json`: what was picked and how it was checked

22 items, newest first, from March 1, 2008 back to the coming-soon page of August 26, 2006. Each link was checked three ways:

1. HTTP GET in Wayback's normal viewer form, following redirects: status 200 and no redirect;
2. the page contains the title (and, for posts, the original blurb);
3. opened in Chromium, the page stays on the same URL (no script bounce) and shows the title.

Links prefer a capture of the article itself. Otherwise they point to the earliest homepage capture that holds the headline.

| Date | Title | Kind | Link | Byline |
|---|---|---|---|---|
| 2008-03-01 | WiiVolve Reconstruction Plan | post | the post itself | Ali |
| 2007-09-04 | New Nintendo Trademarks Hint at Future | post | the post itself | Ali |
| 2007-08-20 | Super Metroid: A Eulogy | feature | the article itself | Kevin |
| 2007-08-12 | Top Ten Finish for the Wii Car! | post | the post itself | Kevin |
| 2007-08-10 | Metroid Month | post | the post itself | Kevin |
| 2007-08-09 | Stroke Victim Wants Wii-hab | post | the post itself | Ali |
| 2007-07-29 | Doggy-Bone Shaped Pedometer for Wii Gamers | post | the post itself (2010 capture) | Ali |
| 2007-06-28 | Jim Ward Talks Wii and Star Wars | post | homepage, 2007-07-03 | |
| 2007-06-27 | WiiWare Officially Has a Purpose | post | homepage, 2007-07-03 | |
| 2007-06-21 | Nine-Day Warning: Internet Channel Not Free Forever | post | homepage, 2007-07-03 | |
| 2007-06-21 | CNN says that Miyamoto Matters | post | homepage, 2007-07-03 | |
| 2007-06-07 | WiiVolve is Back on Track | post | the post itself | Ali |
| 2007-04-29 | The Legend of Zelda: Twilight Princess | review | the review itself (2007-11-30 capture) | Krystal |
| 2007-03-18 | Wii Takes Gold! | post | homepage, 2007-03-21 | |
| 2007-01-26 | Wii News Channel Launches Tomorrow | post | the post itself | Ali |
| 2007-01-02 | Wii Sports the Best Game of 2006 | post | homepage, 2007-01-07 | |
| 2006-11-21 | Nintendo and Sony Sell Out | post | homepage, 2006-11-28 | |
| 2006-11-14 | The Battle Begins: Wii vs PS3 | post | homepage, 2006-11-17 | |
| 2006-11-09 | Internet Explorer Detected | milestone | the browser-check page | |
| 2006-10-16 | Trauma Center Interview | feature | the article itself | Ali |
| 2006-09-13 | Welcome to WiiVolve.com! | post | News Archive, 2007-02-12 | |
| 2006-08-26 | New Site Coming Soon | milestone | the page itself | |

Notes on the picks:

- **June 2007 posts.** No June homepage capture holds the June 18–29 posts; the first one that does is July 3, 2007, the "2007 heyday" snapshot.
- **"Welcome to WiiVolve.com!"** has no capture of its own and no homepage capture from September 2006 (none exists). It links to the site's own News Archive, which lists it as "September 13, 2006 - Welcome to WiiVolve.com!". No blurb survives, so the excerpt is empty.
- **Twilight Princess review.** Wayback's viewer redirects the July 2007 capture to the November 30, 2007 one (same review), so the November timestamp is linked directly.
- **The browser-sniffing milestone** links the IE notice (captured 2006-11-09) rather than the 2006-11-07 splash, for the reason in section 7. The literal alternative: id `wv-launch-splash`, title "Detecting Browser... Please Wait.", 2006-11-07, https://web.archive.org/web/20061107153406/http://wiivolve.com/ (HTTP 200 and contains the title, but bounces to an error in non-Firefox browsers).
- **`published` dates** are the real day at 12:00:00Z. The site printed some post times (e.g. "13:12") without a time zone, so no times are used.

**Every edit made to the original text.** Titles are verbatim. Excerpts are verbatim except:

- Straight apostrophes became typographic ones (’) in the excerpts of: Metroid Month (It’s), Stroke Victim (Nintendo’s), Doggy-Bone Pedometer (can’t), Jim Ward (they’ve), WiiWare (Channel’s), Nine-Day Warning (console’s, won’t), CNN/Miyamoto (Miyamoto’s), Nintendo and Sony Sell Out (didn’t), The Battle Begins (We’ve), Trauma Center Interview (everyone’s).
- One typo fixed: Stroke Victim, "as its used" → "as it’s used".
- One truncation (the Item contract caps excerpts at 220 characters): the Trauma Center Interview blurb was cut at a word boundary to 217 characters ending in "…".
- Left as written: "A new batch of trademarks give us clues…", "Read on...", "We hope you do.", "FireFox".
- The two milestones had no blurb, so their excerpts are original page text. The IE notice uses its first two sentences verbatim. The coming-soon page uses its own `<title>` tagline, "Your Number One Source for Wii News!" (without the "WiiVolve.com | " prefix).
- One addition that is not original text: the coming-soon excerpt ends with the note "(The page’s artwork was never archived.)".

Verified alternates, if a swap is wanted:

| Title | Kind | Date | Link | Note |
|---|---|---|---|---|
| Serena Williams Plays Wii Sports | feature | 2007-02-02 | https://web.archive.org/web/20070507042733/http://wiivolve.com/article.php?articleId=69&page=1 | Blurb has the typo "O'Brian" for "O'Brien" |
| How to Build a Wii Laptop | feature | 2007-01-23 | https://web.archive.org/web/20070614103632/http://wiivolve.com/article.php?articleId=61&page=1 | A reprint, subtitled "Credits go to Engadget." |
| WarioWare: Smooth Moves | review | 2007-02-22 | https://web.archive.org/web/20070507042621/http://wiivolve.com/review.php?articleId=77&page=1 | "The best game to play with an uptight grandparent." |
| Wii Smart Fortwo Fleet | post | 2007-06-18 | https://web.archive.org/web/20070703152325/http://wiivolve.com/ | |
| Sony Eats Nintendo's Dust | post | 2007-06-25 | https://web.archive.org/web/20070703152325/http://wiivolve.com/ | |

## 9. `headlines-full.json`

289 distinct headlines: 220 posts, 40 reviews, 21 features, 8 previews. Each entry has `{ title, date, blurb, kind, originalUrl, bestArchiveUrl, sourceCapture }`, sorted newest first.

They were harvested from:

- every homepage capture from 2006-11 through 2009 (the bare domain, `index.php` and `index.php?system=Wii`);
- every News Archive capture;
- the post, article, review and preview captures;
- the list pages.

How the fields were filled:

- **Titles** come from the article's own page when it was captured, otherwise from the homepage or News Archive, with the 2006 " (Wii)" suffix removed.
- **Blurbs** are verbatim, with entities decoded and tags stripped. They come from the earliest homepage row, or the article's own subtitle. 149 entries have one.
- **`date` is null for 35 reviews, features and previews** seen only in lists, which carry no dates.
- **`bestArchiveUrl`** is the article's own capture where one exists (66 entries), otherwise the earliest homepage, News Archive or list capture that holds the headline. All 88 distinct URLs were fetched in the normal viewer form and returned 200 with the title on the page; the one that redirected was replaced by its final URL.
- **`sourceCapture`** is the capture the blurb (or, without a blurb, the title) was read from.
