// RSS 2.0 and JSON Feed 1.1 writers for the live items. See docs/ARCHITECTURE.md section 4.6.
// Both are pure functions of their inputs. Archive items never appear here.

import { escapeXml, isoSeconds } from './util.mjs';
import { isHttpUrl } from './text.mjs';

/** RFC 822 date as used by RSS: "Wed, 04 Nov 2026 16:17:00 GMT". */
export function rfc822(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toUTCString() : '';
}

function liveOnly(items) {
  return (items || []).filter((it) => it && it.tab !== 'archive' && isHttpUrl(it.url));
}

/**
 * @param {{ site: object, items: object[], sources?: object[], generatedAt: string }} args
 * @returns {string} RSS 2.0 document
 */
export function renderRss({ site, items, sources = [], generatedAt }) {
  const base = String(site.url || '').replace(/\/+$/, '');
  const feedUrls = new Map(sources.map((s) => [s.id, s.url]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escapeXml(site.name)}</title>`,
    `<link>${escapeXml(`${base}/`)}</link>`,
    `<description>${escapeXml(site.description || site.tagline || site.name)}</description>`,
    '<language>en</language>',
    `<lastBuildDate>${rfc822(generatedAt)}</lastBuildDate>`,
    '<ttl>60</ttl>',
    `<atom:link href="${escapeXml(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
  ];
  for (const it of liveOnly(items)) {
    lines.push('<item>');
    lines.push(`<title>${escapeXml(it.title)}</title>`);
    lines.push(`<link>${escapeXml(it.url)}</link>`);
    lines.push(`<guid isPermaLink="false">${escapeXml(it.id)}</guid>`);
    lines.push(`<pubDate>${rfc822(it.published)}</pubDate>`);
    if (it.excerpt) lines.push(`<description>${escapeXml(it.excerpt)}</description>`);
    const srcUrl = feedUrls.get(it.sourceId);
    if (srcUrl && isHttpUrl(srcUrl)) lines.push(`<source url="${escapeXml(srcUrl)}">${escapeXml(it.source)}</source>`);
    lines.push(`<category>${escapeXml(it.tab)}</category>`);
    lines.push('</item>');
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}

/**
 * @param {{ site: object, items: object[] }} args
 * @returns {object} JSON Feed 1.1 object (serialise with JSON.stringify)
 */
export function buildJsonFeed({ site, items }) {
  const base = String(site.url || '').replace(/\/+$/, '');
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: site.name,
    home_page_url: `${base}/`,
    feed_url: `${base}/feed.json`,
    description: site.description || site.tagline || site.name,
    icon: `${base}/icon-512.png`,
    favicon: `${base}/icon-192.png`,
    language: 'en',
    items: liveOnly(items).map((it) => ({
      id: it.id,
      url: it.url,
      title: it.title,
      content_text: it.excerpt || it.title,
      date_published: isoSeconds(it.published),
      authors: [{ name: it.source }],
      tags: [it.tab],
    })),
  };
}

export function renderJsonFeed(args) {
  return `${JSON.stringify(buildJsonFeed(args), null, 2)}\n`;
}
