# WiiVolve runbook

Everything you will ever do by hand. The one-time setup takes about 30 minutes; after that the site runs itself, and it only contacts you through GitHub: a `site-check` issue when the Monday check finds something broken (a source counts only after a week down), or an email if a run fails outright.

* [One-time setup](#one-time-setup), steps 1 to 10
* [Launch checklist](#launch-checklist)
* [Operations](#operations)
* [Troubleshooting](#troubleshooting)
* [Reference](#reference)

---

## One-time setup

**You need:** the Cloudflare account that holds wiivolve.com (its nameservers are `angela.ns.cloudflare.com` and `sage.ns.cloudflare.com`), a GitHub account, Node 22 or later on your Mac (`node --version`), and this folder. Every command below runs in the project folder:

```sh
cd ~/Documents/Claude/WiiVolve
```

### 1. Log in to Cloudflare from the terminal

```sh
npx --yes wrangler@4 login
```

A browser window opens; select **Allow**. Check it worked:

```sh
npx --yes wrangler@4 whoami
```

It prints your email and a table with your **Account Name** and **Account ID**. Keep the Account ID for step 7.

### 2. Remove the old DNS records (this is what causes the 523)

wiivolve.com currently answers with Cloudflare error 523 because its DNS record still points at the old server, which no longer exists. The new site attaches itself to the domain as a Workers *Custom Domain*, and Cloudflare creates that DNS record itself. It refuses to do so while another CNAME record has the same name, so clear the way first.

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/), select **wiivolve.com**, then **DNS** > **Records**.
2. Delete every record of type **A**, **AAAA** or **CNAME** whose **Name** is `wiivolve.com` or `www`. (Open the record, select **Delete**, confirm.)
3. Leave **MX**, **TXT** and other record types alone. Leftover A/CNAME records for old names such as `ftp`, `mail`, `cpanel` or `webmail` point at the same dead server and can go too, but they do no harm.

Until step 3 is done, wiivolve.com shows "server not found" instead of the 523. That is expected.

### 3. Deploy once from your Mac

This creates the Worker (the Cloudflare project) named `wiivolve`, uploads the site, and attaches wiivolve.com.

```sh
npm test
npm run build
npx --yes wrangler@4 deploy
```

`npm run build` fetches the feeds once and writes the page. During `deploy`, wrangler may ask:

* **to register a workers.dev subdomain** (only for the first Worker on your account): type any name, for example your username. The site will also be reachable at `https://wiivolve.<that-name>.workers.dev`.
* **"You already have DNS records that conflict for these Custom Domains ... Update them to point to this script instead?"**: answer `y`. A record from step 2 was missed; this replaces it.

The deploy ends with a list like this:

```
Deployed wiivolve triggers
  https://wiivolve.<your-subdomain>.workers.dev
  wiivolve.com (custom domain)
```

Open <https://wiivolve.com>. Cloudflare issues the certificate on first use; if you see a certificate or "can't be reached" error, wait 10 to 15 minutes and try again. In **DNS** > **Records** you will now see a read-only record for `wiivolve.com` that points at the Worker (shown with type **Worker**): Cloudflare manages it, leave it alone.

### 4. Send www.wiivolve.com to wiivolve.com

`www.wiivolve.com` needs a DNS record so Cloudflare can answer for it, plus one redirect rule. (It is not a second Custom Domain on purpose: one address, no duplicate pages.)

1. **DNS** > **Records** > **Add record**: Type `AAAA`, Name `www`, IPv6 address `100::`, Proxy status **Proxied** (orange cloud), TTL Auto. **Save**. (`100::` is a reserved placeholder address; Cloudflare answers for the name itself, so nothing ever goes there.)
2. **Rules** > **Overview** > **Create rule** > **Redirect Rule** (or **Rules** > **Redirect Rules** > **Create rule**). If the template **Redirect from WWW to Root** is offered, pick it and check the values below; otherwise fill them in:
   * Rule name: `www to wiivolve.com`
   * If incoming requests match: **Wildcard pattern**, Request URL `http*://www.wiivolve.com/*`
   * Then: Target URL `https://wiivolve.com/${2}`, Status code **301**, **Preserve query string** on
   * **Deploy**
3. **SSL/TLS** > **Edge Certificates** > **Always Use HTTPS**: **On**. Old forum links use `http://`; this sends them to `https://` first.

Check (in Terminal):

```sh
curl -sI "https://www.wiivolve.com/d2w.php" | grep -i '^location'
# location: https://wiivolve.com/d2w.php
curl -sI "https://wiivolve.com/d2w.php" | grep -i '^location'
# location: https://web.archive.org/web/2008/http://wiivolve.com/d2w.php
```

Old links with an id (`fullNews.php`, `article.php`, `review.php`, `preview.php`, `gameInfo.php`, `cheat.php`) have no edge redirect on purpose: the page's own script sends them to their best capture, so check one in a browser. <https://wiivolve.com/fullNews.php?newsId=213> should land on the June 14, 2007 capture of "WiiVolve is Back on Track" (`https://web.archive.org/web/20070614103113/...`).

### 5. Put the code on GitHub

The repository should be **public**: GitHub Actions minutes are free and unlimited for public repositories, and the code is part of the tribute.

**First, make sure this folder is a Git repository:** run `git status`. If it says "not a git repository", run `git init -b main`.

**Then keep your email address private.** Every commit records an email address, and in a public repository anyone can read it. On GitHub open **Settings** > **Emails**, turn on **Keep my email addresses private**, and copy the address it shows (`<number>+<username>@users.noreply.github.com`). Then, in this folder:

```sh
git config user.email "<number>+<username>@users.noreply.github.com"
```

(Your name for the commits is up to you: `git config user.name "..."`.)

**Then put the code up with the GitHub command-line tool.** It also handles signing in, which plain `git push` cannot do with a password:

```sh
brew install gh
gh auth login      # GitHub.com, HTTPS, "Authenticate Git with your GitHub credentials": Yes
git add -A
git commit -m "WiiVolve 2026"
gh repo create WiiVolve.com --public --source . --remote origin --push
```

**Without `gh`**, first create an empty repository named `WiiVolve.com` on <https://github.com/new> (**Public**, without a README, .gitignore or license: this folder has them). Then either:

* **GitHub Desktop** (installed on this Mac; it signs in through the browser, no token needed): **File** > **Add Local Repository**, choose this folder, commit every file with the summary `WiiVolve 2026`, then **Publish repository** with **Keep this code private** unticked.
* **or plain git**: GitHub refuses passwords, so create a token for the repository you just made: **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**; **Expiration**: your choice; **Repository access**: **Only select repositories**, `WiiVolve.com`; **Permissions**: **Contents: Read and write** and **Workflows: Read and write** (the push adds `.github/workflows/site.yml`). Then run the commands below. When git asks, type your GitHub **username**, then paste the token as the **password**; macOS keeps it in the keychain. When the token expires, `git push` fails with an authentication error: make a new token the same way, delete the `github.com` entry in **Keychain Access**, and push again.

```sh
git add -A
git commit -m "WiiVolve 2026"
git remote add origin https://github.com/<your-username>/WiiVolve.com.git
git push -u origin main
```

The push starts the first run: open the repository's **Actions** tab and select **site**. It tests, builds, commits the fresh news as `github-actions[bot]`, and shows a yellow **Deploy skipped** warning because the Cloudflare secrets are not there yet. That is expected.

### 6. Create the Cloudflare API token for GitHub

GitHub deploys with a token that can deploy this account's Workers and change the Workers routes of wiivolve.com, and nothing else.

1. In the Cloudflare dashboard go to **Manage account** > **Account API Tokens** ([direct link](https://dash.cloudflare.com/?to=/:account/api-tokens)) and select **Create Token**. (The same works under **My Profile** > **API Tokens**; both kinds of token work with wrangler.)
2. Pick the **Edit Cloudflare Workers** template (under **Permission policies** it may sit in the **Custom** drop-down; on the profile page select **Use template** next to it).
3. Name it `WiiVolve GitHub deploy`.
4. Permissions. This site needs only these three. Remove every other permission the template adds (Workers KV Storage, Workers R2 Storage, Workers Tail, Cloudflare Pages, User Details, Memberships, ...), so a leaked token opens nothing else (the shortcut link below fills in only these three):

   | Type | Permission | Access | Why |
   | --- | --- | --- | --- |
   | Account | Workers Scripts (shown as **Workers: Editor** in the newer layout) | Edit | Upload and deploy the `wiivolve` Worker and its files |
   | Account | Account Settings | Read | wrangler reads the account it deploys to |
   | Zone | Workers Routes | Edit (Write) | Every deploy re-confirms the wiivolve.com Custom Domain |

5. Resources:
   * **Account Resources**: Include, *your account* (not "All accounts").
   * **Zone Resources**: Include, **Specific zone**, `wiivolve.com`.
6. Leave **Client IP Address Filtering** empty (GitHub's servers change) and **TTL** empty (no expiry, so it never needs renewing).
7. **Continue to summary** > **Create Token**. Copy the token now; Cloudflare shows it only once. The page also shows a `curl` command to test it: it should answer `"This API Token is valid and active"`.

Shortcut: [this link](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=WiiVolve%20GitHub%20deploy) opens the profile token form with exactly those three permissions filled in; you still narrow the resources as in step 5 above.

Why this order matters: creating a brand-new Worker needs more rights than updating one. Step 3 created it with your own login, so this token only ever needs to update it.

### 7. Find your Cloudflare account ID

Any of these:

* `npx --yes wrangler@4 whoami` (the **Account ID** column), or
* in the dashboard, press `Cmd + K`, type `Copy account ID` and select the result, or
* **Workers & Pages** > **Account Details** > **Account ID**.

It is a 32-character hex string. It is not secret, but it goes into a secret so it is in one place with the token.

### 8. Add the two secrets to GitHub

In the repository on GitHub: **Settings** > **Secrets and variables** > **Actions** > **New repository secret**, twice:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | the ID from step 7 |

Or with `gh` (each command asks for the value; paste it and press Enter):

```sh
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

### 9. Let GitHub deploy

**Actions** > **site** > **Run workflow** > Branch `main`, task `build` > **Run workflow**. After a minute or two the run is green and the **Deploy to Cloudflare** step ends with `wiivolve.com (custom domain)`. From now on the hourly run deploys by itself whenever the news changes.

Then try the self-check once: **Run workflow** again with task `check`. Its last line should be `No issue needed.`; if something is wrong it opens an issue that says what.

With `gh`: `gh workflow run site.yml -f task=build`, then `gh run watch`.

### 10. Turn on Web Analytics

Free, cookieless, and the only way to know the site is being read.

1. Open the [Web Analytics page](https://dash.cloudflare.com/?to=/:account/web-analytics) of the dashboard and select **Add a site**.
2. Choose `wiivolve.com` from the drop-down and select **Done**.

That is the automatic setup: Cloudflare adds its small beacon script to the page as it passes through its network. The page's Content-Security-Policy (`site/_headers`) already allows it. After a visit or two, check that the beacon is there:

```sh
curl -s https://wiivolve.com/ | grep -c cloudflareinsights
# 1 (or more) means analytics is on
```

If it prints `0` after ten minutes, see [Web Analytics shows nothing](#web-analytics-shows-nothing). To turn analytics off later: **Web Analytics** > **Manage site** > **Disable**.

Done. Finish with the launch checklist.

---

## Launch checklist

From PLAN.md section 9. The target launch is November 19, 2026, the Wii's 20th anniversary.

- [ ] **wiivolve.com and www.wiivolve.com work; the 523 is gone.** `curl -sI https://wiivolve.com/ | head -1` says `200`; `curl -sI https://www.wiivolve.com/ | grep -i '^location'` says `https://wiivolve.com/`.
- [ ] **Namecheap auto-renew is on.** Namecheap > Domain List > wiivolve.com > Auto-Renew: on. The domain expires 2027-11-01.
- [ ] **Both secrets are set, a manual run deployed, and the hourly run has committed at least once.** The repository's commit list shows `Update news: ...` commits by `github-actions[bot]`.
- [ ] **The feeds validate.** <https://validator.w3.org/feed/check.cgi?url=https%3A%2F%2Fwiivolve.com%2Ffeed.xml> passes, and `https://wiivolve.com/feed.xml` opens in a feed reader.
- [ ] **The old-link bounce works with real 2007 links**: <https://wiivolve.com/fullNews.php?newsId=213> lands on the June 14, 2007 capture of the post, <https://wiivolve.com/review.php?articleId=77&page=1> on the May 7, 2007 capture of the WarioWare review, <https://wiivolve.com/fullNews.php?newsId=13> (a post with no capture of its own) on the February 2007 News Archive that lists it, and <https://wiivolve.com/gameInfo.php?gameId=8> on its February 2007 game page. An id the archive never documented (newsId 12) lands on the February 2008 News Archive, the old site's own list of posts.
- [ ] **Phone check** in Safari and Chrome, in light and dark mode, and once with Reduce Motion on (iOS: Settings > Accessibility > Motion).
- [ ] **Lighthouse 100/100/100/100** (Chrome DevTools > Lighthouse, or <https://pagespeed.web.dev/>).
- [ ] **Share preview** looks right in an Open Graph debugger, for example <https://www.opengraph.xyz/> or by pasting the link into a chat app.
- [ ] **Analytics shows the first visit** (Web Analytics, after visiting the site yourself).
- [ ] **The self-check passes**: Actions > site > Run workflow, task `check`, ends with `No issue needed.`

---

## Operations

From PLAN.md section 10.

* **Nothing is on your calendar.** The build runs every hour at minute 17 and the self-check every Monday at 09:00 UTC, on their own.
* **You hear from the site only through GitHub:** a `site-check` issue when the Monday check finds a problem (the live page, a feed or an archive link broken, `health.json` over 26 hours old, or a source down for more than a week; it gets a comment every Monday while that lasts and closes itself once everything passes), or GitHub's email about a failed run. Both are rare. Make sure GitHub notifications for the repository reach your inbox (watch the repository: **Watch** > **All Activity**, or at least **Issues**).
* **Once a year:** the domain renews (auto-renew on). That is the only human task.
* **If the list looks off** (a non-Wii story got in, or Wii stories are missing): change a keyword, an exclusion or a flag in `feeds.json` (see README, "Changing what the page shows"), push, and the push run rebuilds within minutes. The push run fetches every feed in full and re-checks the stories already on the page against the new rules. To remove one story for good, add an `exclude` pattern for its title.
* **If a source dies for good:** delete its entry in `feeds.json` and push. Leave `tests/fixtures/` alone; the tests do not depend on `feeds.json`.
* **Optional:** an outside uptime monitor (UptimeRobot or similar, free) watching `https://wiivolve.com/health.json` would notice even if GitHub stopped running the workflow, which the weekly check cannot. Nothing here needs one.

Doing things by hand:

| Want to | Do |
| --- | --- |
| Rebuild and deploy now | Actions > site > Run workflow, task `build` (or push any commit to `main`) |
| Run the self-check now | Actions > site > Run workflow, task `check` |
| See what the last build did | Actions > site > the latest run > its summary (a table of every source) |
| Check the live site from your Mac | `npm run check` |
| Undo a bad change | `git pull --rebase`, `git revert <sha>`, `git push` (or in GitHub Desktop: **History**, right-click the commit, **Revert Changes in Commit**, then **Push origin**); the push rebuilds and deploys. GitHub's web Revert button only exists for pull requests, and these changes go straight to `main`. For an instant fix while you look, in this order: set the repository variable `DEPLOY_HOLD` to `true` (below) and wait until no **site** run is in progress (Actions tab); then `npx --yes wrangler@4 rollback` puts the previous version back live. (The other way round, an hourly run in between sees the live site behind the committed build and deploys the bad one again.) Delete the variable once the revert is pushed, then **Run workflow**. |
| Pause deploys | **Settings** > **Secrets and variables** > **Actions** > **Variables** > **New repository variable**: `DEPLOY_HOLD` = `true`. Builds, commits and the weekly check carry on; nothing is deployed. Delete the variable to resume; the next run deploys the latest build. |
| Stop everything | **Actions** > **site** > **...** > **Disable workflow** (this also stops the weekly check). The site stays up with its last deploy. To take the site itself offline, remove the Custom Domain under **Workers & Pages** > **wiivolve** > **Settings** > **Domains & Routes**. |
| Start the builder's memory over | Commit `{}` as `state/state.json` and push. The next build fetches every feed in full; it keeps today's stories (they come back from `site/news.json`) but forgets the ETags, the failure counts and when it first saw each story. Delete `site/news.json` in the same commit (`git rm site/news.json`) only if you also want launch-day rules again: with neither file the build counts as the first run, so every story's "first seen" time becomes its publication time and nothing is marked new. |
| Deploy by hand | `git pull --rebase` first, then `npx --yes wrangler@4.157.0 deploy` (after `npx --yes wrangler@4 login`), without `npm run build`: `main`'s `site/` is the bot's latest build, while a build on your Mac starts from your copy and has no GitHub links. This also creates the Worker again if it was deleted. |
| Update wrangler | Try the new version with `npx --yes wrangler@<new> dev`; when the site and the old links answer as before, replace `4.157.0` in `package.json` (two scripts) and `.github/workflows/site.yml` (`grep -rn 4.157.0 .` finds the docs that name it too) and push. Until then the pinned version keeps deploying. |
| Move CI to a newer Node | When a new Node version is out, run `npm test` with it; if it passes, change `node-version: 26` in the three jobs of `.github/workflows/site.yml` and push. Nothing switches on its own. |

---

## Troubleshooting

### Deploy fails

The **Deploy to Cloudflare** step is red and GitHub emails you. The live site keeps the previous version; nothing is lost, and every hourly run deploys again until the live site matches the committed build (it compares the two `health.json` files), so a passing problem fixes itself. Open the failed run, expand the step and look for the error line:

* **`Authentication error [code: 10000]`**, "Invalid access token", or "not authorized": the token was deleted, revoked, or is missing a permission. Create a new one (step 6), replace the `CLOUDFLARE_API_TOKEN` secret (step 8), then **Run workflow**.
* **The Worker does not exist** (for example it was deleted in the dashboard): follow "Deploy by hand" (Operations) from your Mac, which creates it again with your login, then **Run workflow**.
* **An error about the Custom Domain or a conflicting DNS record** (for example "existing CNAME record"): a DNS record for `wiivolve.com` came back. In **DNS** > **Records** delete the A, AAAA or CNAME records named `wiivolve.com` (keep the one of type **Worker**), then **Run workflow**. CI answers wrangler's "replace the existing record?" question with yes on its own, but Cloudflare never lets a Custom Domain replace a CNAME.
* **npm or network errors while downloading wrangler**: temporary. The next hourly run tries again, or **Run workflow**.
* **Anything else**: deploy once from your Mac to see the same error interactively (after `npx --yes wrangler@4 login`; follow "Deploy by hand" above), or search the error text in the [Cloudflare community](https://community.cloudflare.com/).

### The run shows "Deploy skipped"

One or both secrets are missing or misspelled. The names must be exactly `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (step 8). The build and the commit still happened; only the deploy was skipped.

### The run shows "Push failed"

The bot could not push its commit to `main` three times in a row. Usually a branch protection rule or ruleset on `main` blocks it: **Settings** > **Rules** (or **Branches**) > allow GitHub Actions to push, or remove the rule. If the log says `403` or "Permission denied", check **Settings** > **Actions** > **General** > **Workflow permissions**; the workflow asks for `contents: write` itself, so "Read repository contents" is fine unless an organization policy caps it.

A yellow **Commit dropped** warning is harmless: you pushed to `main` while a build was running, and the run for your push rebuilds everything. So is a **Deploy left to the newer run** notice: your push arrived during an hourly run, which committed but did not deploy a page built from the older files; the run for your push deploys.

### The hourly schedule stopped

GitHub disables scheduled workflows in a public repository after 60 days without repository activity. The bot commits at least once a day, so this only happens if builds have been failing for two months; fix that first (see the failed runs). Then: **Actions** > **site** > the banner "This scheduled workflow is disabled" > **Enable workflow**, and **Run workflow** once.

GitHub may also start scheduled runs late or, when it is very busy, skip one. That is harmless; the next hour catches up.

### A source goes down

The About panel marks the source "Retrying" after its first failed hour and "Down" after three in a row; from the first failed hour the footer counts one source fewer ("8 of 9 sources OK"). After it has been down for 7 days, the Monday check opens a `site-check` issue that names it and its last error. Its last good stories stay on the page meanwhile.

1. Open the source's `url` from `feeds.json` in a browser.
2. If the feed moved, put the new address in `url` and push. Leave `tests/fixtures/` as it is: the tests keep using the old saved copy, which is fine.
3. If it is gone or keeps failing, delete its entry in `feeds.json` and push.

The next Monday check closes the issue by itself. You can also just leave it; the issue gets one comment a week.

### Reddit blocks GitHub's servers

`r/wii` and `r/WiiHacks` are best effort: Reddit often answers 403 or 429 to data-centre addresses like GitHub's. They ask with an honest, descriptive User-Agent (`web:com.wiivolve.news:v1.0 (+https://wiivolve.com/)`), as Reddit's rules require; you can add your Reddit username to it in `feeds.json` (`... (by /u/yourname; +https://wiivolve.com/)`). Nothing breaks; their last good posts stay and the footer counts them as not OK. If both stay down for a week the issue appears. Either wait (blocks come and go) or delete the two `reddit-*` entries from `feeds.json`; the page carries on with the other seven sources.

### wiivolve.com shows an error

* **523 or 522** (origin unreachable): an old DNS record points at the dead server again. Do step 2, then **Run workflow**.
* **"Server not found"**: there is no DNS record for wiivolve.com, so the Custom Domain is missing. **Run workflow** (every deploy re-attaches it), or follow "Deploy by hand" (Operations).
* **Certificate error** right after attaching the domain: wait 15 minutes.
* **www.wiivolve.com does not redirect**: redo step 4; the `www` record must be **Proxied**.
* **The weekly check says HTTP 403 for the site**: **Security** > **Settings**, filter **Bot traffic**, **Bot fight mode**: turn it off for this zone (in the older dashboard layout: **Security** > **Bots**); it challenges GitHub's servers and some feed readers. Keep it off in any case: it injects its own inline script, which the page's Content-Security-Policy refuses, so visitors' browsers log errors.

### An archive link broke

The issue says "Archive link is broken (HTTP 404, twice a minute apart)". The Wayback Machine sometimes loses a capture. Find another capture of the same page at `https://web.archive.org/web/*/wiivolve.com/<page>` and update the link in `site/archive.json` (or the About panel's snapshot links in the page template), or remove the item. If web.archive.org itself was down, the check only adds a note and tries again next week.

### The weekly check itself fails

The **Weekly self-check** job is red: GitHub refused to create or update the issue, nearly always because Issues are turned off (**Settings** > **General** > **Features** > **Issues** on, then **Run workflow** with task `check`), or the job ran out of time (it stops checking archive links after 8 minutes and normally ends well inside its 30; if it was killed, simply run it again).

### Web Analytics shows nothing

First visit the site yourself and give it a few minutes. If `curl -s https://wiivolve.com/ | grep -c cloudflareinsights` still prints `0`, the automatic injection is not reaching the page. Switch to the manual snippet: **Web Analytics** > **Manage site** > **Enable with JS Snippet installation**, copy the token from the snippet, and add this line before `</body>` in `templates/index.html` (an external script, which the Content-Security-Policy already allows), then push:

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "PASTE-THE-TOKEN"}'></script>
```

---

## Reference

### What runs when

All in `.github/workflows/site.yml`:

| Trigger | Job | What happens |
| --- | --- | --- |
| Every hour at :17 | Build and deploy | Tests, builds; commits and deploys when the build reports `changed=true`; deploys the committed build again when the live site is behind it |
| Push to `main` | Build and deploy | Tests, builds with `--force`, commits if anything changed, deploys |
| Run workflow, task `build` | Build and deploy | Same as a push (deploys only from `main`) |
| Mondays 09:00 UTC | Weekly self-check | `node scripts/check.mjs`: opens, comments on or closes the `site-check` issue |
| Run workflow, task `check` | Weekly self-check | The same, now |
| Pull request to `main` | Test and dry build | Tests and an offline build; nothing is committed or deployed |

Builds never overlap: queued builds wait for the running one, and a waiting push run is never cancelled by the next hourly run. The deploy is skipped with a warning when either secret is missing, and with a notice while `DEPLOY_HOLD` is `true`. Pushes made by the job's own token do not start new runs, so there are no loops.

### Secrets and settings

| Where | Name | Purpose |
| --- | --- | --- |
| Repository secret | `CLOUDFLARE_API_TOKEN` | Deploys (step 6) |
| Repository secret | `CLOUDFLARE_ACCOUNT_ID` | Deploys (step 7) |
| Repository variable (optional) | `SITE_URL` | Points the weekly check (and the hourly "is the live site behind?" check) somewhere else, for example the workers.dev address, before the domain is attached |
| Repository variable (optional) | `DEPLOY_HOLD` | `true` pauses every deploy; see "Doing things by hand" |

The bot commits only the six generated files: `site/index.html`, `site/news.json`, `site/feed.xml`, `site/feed.json`, `site/health.json` and `state/state.json`.

**Costs.** Workers Static Assets (no Worker script) and Web Analytics are free; GitHub Actions is free for public repositories. The only bill is the domain renewal.

### How the domain is wired

* `wrangler.jsonc` lists `wiivolve.com` as a Custom Domain (`"custom_domain": true`). The Worker is the origin; Cloudflare manages the DNS record (type **Worker**) and the certificate. Every deploy sends the full list of Custom Domains for this Worker, so a domain removed in the dashboard comes back on the next deploy, and a domain added only in the dashboard would be removed. Add domains in `wrangler.jsonc`, not in the dashboard.
* When the name already has an A or AAAA record, an interactive `wrangler deploy` asks before replacing it, and a deploy in CI replaces it without asking (wrangler 4 sends `override_existing_dns_record` when not attached to a terminal). A CNAME can never be replaced that way, which is why step 2 deletes the old records first.
* `www.wiivolve.com` is a proxied placeholder record plus a Redirect Rule, as Cloudflare recommends for www and apex.
* The site also answers at `https://wiivolve.<your-subdomain>.workers.dev` (`"workers_dev": true`), which is handy for checking a deploy before DNS is ready. Each page names `https://wiivolve.com` as its canonical address, so search engines index only the real domain.

### Old links

* **Old articles, game and cheat pages** (`fullNews.php?newsId=`, `article.php`, `review.php`, `preview.php?articleId=`, `gameInfo.php?gameId=`, `cheat.php?cheatId=` or `?gameId=`): no edge rule. Cloudflare answers with `site/404.html` (status 404), whose `404.js` looks the page up in `site/legacy-map.json` and sends the browser to its best capture (most posts never had one of their own, so the "2008" form of their address would be "not archived"). Any spelling works (`FullNews.php`, `newsid=`, a trailing slash, `&page=1`). An id the map does not know goes to the old site's own list for that kind of page (the News Archive, the features, reviews A to Z, previews, the game database, cheats A to Z). Without JavaScript the 404 page links those lists instead. The map is built from `legacy-assets/headlines-full.json` and `legacy-assets/wayback-url-index.json` by `npm run legacy-map`.
* **Every other old `.php` page and the old folders** (`/downloads/`, `/images/`, `/browser/`, `/gigazero/`, `/error/`): `site/_redirects` answers at the edge with a 302 to `https://web.archive.org/web/2008/http://wiivolve.com<path><query>`, keeping the query string; `/rss.php` goes to `/feed.xml` and `/index.php` to `/` (301). Rules match the path exactly and case-sensitively; anything they miss gets the 404 page, which bounces legacy-looking paths in the browser.
* Verified with `wrangler dev` 4.157.0, which runs the same asset-serving code as Cloudflare's network; `npm run serve` is pinned to the same answers by `tests/serve.test.mjs`. After editing `site/_redirects` or `site/_headers`, check with `npm run preview` and run `npm test` (`tests/hosting.test.mjs` reads both files strictly, because Cloudflare only warns about a bad line).
