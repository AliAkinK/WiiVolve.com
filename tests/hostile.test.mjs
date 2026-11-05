// Hostile or garbled feeds must not stall the hourly build (engine-1): every scanner is linear.
// The old regexes took hours on some of these inputs (an exponential DOCTYPE pattern and quadratic
// tag, close-tag and trailing-punctuation scans), so a generous bound cannot be flaky: linear code
// handles each 1 MB case in well under a second, quadratic code never finishes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, MAX_ENTRIES } from '../scripts/lib/parse.mjs';
import { stripTags, titleText, cleanExcerpt, parseDate } from '../scripts/lib/text.mjs';

const MB = 1 << 20;
const LIMIT_MS = 5000;
const fill = (unit, bytes = MB) => unit.repeat(Math.ceil(bytes / unit.length));

const cases = {
  // 92 bytes: the old DOCTYPE regex doubled its work with every pair and never finished.
  'DOCTYPE with many [] pairs and no ">" (exponential before)': () => parseFeed(`<!DOCTYPE x ${'[]'.repeat(40)} y`),
  'a real feed after a long internal subset': () => parseFeed(`<!DOCTYPE x ${'[]'.repeat(5000)} y<rss><channel><item><title>Wii</title></item></channel></rss>`),
  'many unterminated <!DOCTYPE[': () => parseFeed(fill('<!DOCTYPE[')),
  // One "<" and a tag name that never ends: the name and the attribute part used to split it every way.
  'a tag name that never closes (stripTags)': () => stripTags(`<a${fill('b')}`),
  'a close-tag name that never closes': () => stripTags(`</a${fill('b')}`),
  'a tag name of hyphens': () => stripTags(`<a${fill('-')}`),
  'a never-closed tag name in an excerpt': () => cleanExcerpt(`<p>Wii</p><x${fill('y')}`),
  'a never-closed tag name inside an RSS description': () => parseFeed(`<rss><channel><item><title>Wii</title><description>&lt;a${fill('b')}</description></item></channel></rss>`).items.map((i) => cleanExcerpt(i.description)),
  // One entry that repeats an element the parser takes out: the rest used to be rebuilt once per copy.
  'one RSS item repeating <description></description>': () => parseFeed(`<rss><channel><item>${fill('<description></description>')}</item></channel></rss>`),
  'one RSS item repeating an unclosed <source>': () => parseFeed(`<rss><channel><item>${fill('<source>')}</item></channel></rss>`),
  'one Atom entry repeating <summary>': () => parseFeed(`<feed><entry>${fill('<summary>')}</entry></feed>`),
  '150,000 tiny entries': () => parseFeed(`<rss><channel>${fill('<item><title>a<link>http://a/1', 4.5 * MB)}`),
  'many unclosed items': () => parseFeed(`<rss><channel>${fill('<item><title ')}`),
  'many processing-instruction starts': () => parseFeed(fill('<?')),
  'tags that never close (stripTags)': () => stripTags(fill('<a')),
  'line-break tags that never close': () => stripTags(fill('<p')),
  'script openers without a close tag': () => stripTags(fill('<script>x')),
  'declarations without ">"': () => stripTags(fill('<!x')),
  'inline title tags that never close': () => titleText(fill('<b')),
  'a post of hyphens (trailing separators)': () => cleanExcerpt(`a${fill('-')}b`),
  'a post of dots (trailing ellipsis rule)': () => cleanExcerpt(`a${fill('.')}b`),
  'a date full of parentheses': () => parseDate(fill('(')),
};

for (const [name, fn] of Object.entries(cases)) {
  test(`linear on hostile input: ${name}`, () => {
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    assert.ok(ms < LIMIT_MS, `${Math.round(ms)} ms`);
  });
}

test('a feed is read up to its first MAX_ENTRIES entries', () => {
  const many = parseFeed(`<rss><channel>${Array.from({ length: 2000 }, (_, i) => `<item><title>Wii ${i}</title><link>https://a.example/${i}</link></item>`).join('')}</channel></rss>`);
  assert.equal(MAX_ENTRIES, 500);
  assert.equal(many.items.length, MAX_ENTRIES);
  assert.equal(many.items.at(-1).title, 'Wii 499', 'in document order');
  const atom = parseFeed(`<feed>${'<entry><title>x</title></entry>'.repeat(600)}</feed>`);
  assert.equal(atom.items.length, MAX_ENTRIES);
});

test('results on hostile input are unchanged where the input is a real feed', () => {
  const doc = `<!DOCTYPE rss [<!ENTITY x "y">]><rss><channel><item><title>Wii one</title><description>&lt;p&gt;Body&lt;/p&gt;</description></item><item><title>Wii two</title></item></channel></rss>`;
  const feed = parseFeed(doc);
  assert.equal(feed.format, 'rss');
  assert.deepEqual(feed.items.map((i) => i.title), ['Wii one', 'Wii two']);
  // An unterminated comment in item 2 of 3 leaves the other items alone (nothing is swallowed).
  const stray = parseFeed('<rss><channel><item><title>A</title></item><item><title>B <!-- oops</title></item><item><title>C</title></item></channel></rss>');
  assert.equal(stray.items.length, 3);
  assert.equal(stripTags('<script>a<script>b</script>after <SCRIPT>x</script >end'), 'after end');
  assert.equal(stripTags('<svg><script>x</script>text'), 'text', 'an unclosed <svg> leaves the rest readable');
  assert.equal(cleanExcerpt('<p>Ends with dots ....</p>'), 'Ends with dots…');
  assert.equal(cleanExcerpt('<p>Trailing seps - | :</p>'), 'Trailing seps');
  // A tag name is still read whole: the attribute part starts where the name ends.
  assert.equal(stripTags('<abbr title="x">Wii</abbr> <my-tag data-x="1">U</my-tag> a<b'), 'Wii U a<b');
  // An entry with two descriptions keeps the first, as before.
  const twice = parseFeed('<rss><channel><item><title>T</title><description>one</description><link>https://a.example/</link><description>two</description></item></channel></rss>');
  assert.deepEqual([twice.items[0].description, twice.items[0].link], ['one', 'https://a.example/']);
});
