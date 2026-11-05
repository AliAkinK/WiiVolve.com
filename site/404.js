// Old wiivolve.com links (2006-2008) still circulate. site/_redirects sends most of them to the Wayback
// Machine at the edge, keeping the query string. Its rules match exact, case-sensitive paths, so this
// browser-side bounce catches what they miss (other capitalisations, a trailing slash, a folder without its
// slash) and sends it to the same place: /rss.php -> /feed.xml, /index.php -> /, other .php pages and the
// old folders -> the 2008 archive, with endpoint names spelled as the old site (and _redirects) spell them.
//
// The endpoints with an id have no edge rule on purpose (docs/ARCHITECTURE.md 7.4): a post, feature, review,
// preview, game or cheat page goes to its best capture from /legacy-map.json (scripts/build-legacy-map.mjs),
// because most of them have no capture of their own, and an id the map does not know goes to the old site's
// own list of that endpoint's items (the map's "_list"). A map that does not load within 4 seconds falls back
// to the 2008 form. The console's slot glows while the bounce runs.
(() => {
  const KNOWN = 'aboutus article articles cheat cheats competitions contests d2w d2w_subscribe downloads fullNews fullNews-n-xiin gameInfo games index-n-xiin legal mailbag newComment news preview previews review reviews staff stats'.split(' ');
  const IDS = { fullnews: ['newsid'], article: ['articleid'], review: ['articleid'], preview: ['articleid'], gameinfo: ['gameid'], cheat: ['cheatid', 'gameid'] };
  const q = location.search;
  let p = location.pathname.replace(/(\.php)\/$/i, '$1');
  let to = null;
  let key = null;
  let endpoint = null;
  if (/^\/rss\.php$/i.test(p)) to = `/feed.xml${q}`;
  else if (/^\/index\.php$/i.test(p)) to = `/${q}`;
  else if (/\.php$/i.test(p) || /^\/(downloads|images|browser|gigazero|error)(\/|$)/i.test(p)) {
    const m = /^\/([\w-]+)\.php$/i.exec(p);
    const name = m && KNOWN.find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (name) p = `/${name}.php`;
    p = p.replace(/^\/(downloads|images|browser|gigazero|error)(?=\/|$)/i, (dir) => dir.toLowerCase()).replace(/\.php$/i, '.php');
    to = `https://web.archive.org/web/2008/http://wiivolve.com${p}${q}`;
    // The map key, as scripts/build-legacy-map.mjs writes it: "fullnews.php?newsid=267". Parameter names in
    // any case (the first one the endpoint knows); other parameters (page=1) ignored.
    const params = m && IDS[m[1].toLowerCase()];
    if (params) {
      for (const [k, v] of new URLSearchParams(q)) {
        if (params.includes(k.toLowerCase()) && /^\d{1,9}$/.test(v)) {
          endpoint = `${m[1].toLowerCase()}.php`;
          key = `${endpoint}?${k.toLowerCase()}=${Number(v)}`;
          break;
        }
      }
    }
  }
  if (!to) return;
  document.documentElement.classList.add('lit');

  let target = to;
  let gone = false;
  const link = () => {
    const a = document.getElementById('bounce-link');
    if (a) a.href = target;
  };
  const go = (url) => {
    if (gone) return;
    gone = true;
    target = url;
    link();
    location.replace(url);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const line = document.getElementById('bounce');
    if (!line) return;
    line.hidden = false;
    link();
    if (target.startsWith('/')) line.firstChild.textContent = 'Taking you there… ';
  });

  if (!key || !window.fetch) return go(to);
  setTimeout(() => go(to), 4000);
  fetch('/legacy-map.json')
    .then((res) => (res.ok ? res.json() : {}))
    .then((map) => {
      const ok = (u) => typeof u === 'string' && /^https:\/\/web\.archive\.org\/web\//.test(u);
      const best = map && map[key];
      const list = map && map._list && map._list[endpoint];
      go(ok(best) ? best : ok(list) ? list : to);
    })
    .catch(() => go(to));
})();
