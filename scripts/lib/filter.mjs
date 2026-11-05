// Wii keyword rules and exclusions. See docs/ARCHITECTURE.md section 5.4.
//
// - "Wii": case-insensitive, whole word, not followed by optional separators and "U" as a word, so "Wii U",
//   "WiiU", "Wii  U", "Wii-U" and "Wii–U" (any dash) are rejected unless wiiU is true. "Wii's", "Wii-era",
//   "wii sports" and "Wii U.S. sales" are accepted ("U." followed by a letter is an abbreviation).
// - Every other keyword: case-insensitive, whole phrase, word boundaries; the spaces inside a phrase
//   match any run of whitespace or dashes. Phrases starting with "Wii" get the same "not followed by U"
//   rule ("Wii Fit U" is a Wii U game), and the Wii U titles in WII_U_TITLES never count as Wii.
// - Overlapping keywords count once, longest first ("Wii Sports" is one occurrence, not two), and "Wii"
//   right before another keyword is part of the same mention ("Wii Nunchuk" is one occurrence).

const WORD = '[\\p{L}\\p{N}_]';
// Whitespace, the ASCII hyphen, the Unicode hyphens and dashes (U+2010 to U+2015) and the minus sign.
const SEP = '[\\s\\-\\u2010-\\u2015\\u2212]';
// "U" as a word: not followed by a letter, digit or underscore, nor by "." and a letter ("U.S.").
const U_WORD = `u(?!${WORD}|\\.\\p{L})`;
// Wii U games whose names do not end in a bare "Wii U" (or end in "U" after another word).
export const WII_U_TITLES = ['Wii Party U', 'Wii Karaoke U', 'Wii Street U', 'Wii Sports Club'];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(keyword) {
  return keyword
    .trim()
    .split(/\s+/)
    .map(escapeRe)
    .join(`${SEP}+`);
}

/**
 * Compile the keyword list into one matcher.
 * @param {string[]} keywords canonical spellings from feeds.json
 * @param {{ wiiU?: boolean }} opts
 */
export function compileKeywords(keywords, { wiiU = false } = {}) {
  const list = [...new Set((keywords || []).map((k) => String(k).trim()).filter(Boolean))];
  if (wiiU && !list.some((k) => /^wii\s*u$/i.test(k))) list.push('Wii U');
  const order = [...list].sort((a, b) => b.length - a.length || a.localeCompare(b));
  // Tails of Wii-prefixed phrases ("Fit" in "Wii Fit"): plain "Wii" must not match the start of "Wii Fit U" either.
  const tails = list.filter((k) => /^wii\s+\S/i.test(k) && !/^wii\s*u$/i.test(k)).map((k) => phrasePattern(k.replace(/^wii\s+/i, '')));
  const groups = [];
  const canonical = [];
  for (const k of order) {
    let pattern = phrasePattern(k);
    // "Wii" and Wii-prefixed phrases ("Wii Fit U" is a Wii U game) must not be followed by "U".
    if (/^wii(\s|$)/i.test(k) && !/^wii\s*u$/i.test(k) && !wiiU) {
      pattern = `${pattern}(?!${SEP}*${U_WORD})`;
      if (/^wii$/i.test(k) && tails.length) pattern += `(?!${SEP}+(?:${tails.join('|')})${SEP}*${U_WORD})`;
      // Nor be the start of a Wii U title ("Wii Party U", "Wii Sports Club").
      for (const title of WII_U_TITLES) {
        const rest = title.slice(k.length);
        if (title.toLowerCase().startsWith(k.toLowerCase()) && /^\s+\S/.test(rest)) {
          pattern += `(?!${SEP}+${phrasePattern(rest)}(?!${WORD}|\\.\\p{L}))`;
        }
      }
    }
    if (/^wii\s*u$/i.test(k)) pattern = `wii${SEP}*u`;
    groups.push(`(${pattern})`);
    canonical.push(k);
  }
  const source = groups.length ? `(?<!${WORD})(?:${groups.join('|')})(?!${WORD})` : '(?!)';
  return { regex: new RegExp(source, 'giu'), canonical, order: list };
}

/**
 * Count keyword occurrences in `text`.
 * @returns {{ count: number, matched: string[] }} matched = distinct canonical keywords, in feeds.json order
 */
export function matchKeywords(text, matcher) {
  const re = new RegExp(matcher.regex.source, matcher.regex.flags);
  const glue = new RegExp(`^${SEP}+$`, 'u');
  const found = new Set();
  let count = 0;
  let m;
  let prev = null; // the previous match: { keyword, end }
  const s = String(text ?? '');
  while ((m = re.exec(s))) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    const idx = m.findIndex((g, i) => i > 0 && g !== undefined);
    const keyword = idx > 0 ? matcher.canonical[idx - 1] : null;
    if (keyword) found.add(keyword);
    // "Wii Nunchuk", "Wii Balance Board": a bare "Wii" right before another keyword names one thing.
    const compound = prev && /^wii$/i.test(prev.keyword) && glue.test(s.slice(prev.end, m.index));
    if (!compound) count++;
    prev = { keyword, end: m.index + m[0].length };
  }
  return { count, matched: matcher.order.filter((k) => found.has(k)) };
}

/** Compile exclude patterns (regex sources, case-insensitive). Invalid patterns are reported and skipped. */
export function compileExcludes(patterns, onError = () => {}) {
  const out = [];
  for (const p of patterns || []) {
    try {
      out.push(new RegExp(p, 'iu'));
    } catch (err) {
      onError(p, err);
    }
  }
  return out;
}

export function isExcluded(title, excludes) {
  return excludes.some((re) => re.test(String(title ?? '')));
}

/**
 * Decide whether a normalized entry is kept for its source.
 * @param {{ title: string, text?: string }} entry title plus full plain-text description/content
 * @param {{ filter?: string }} source
 * @param {{ matcher: object, excludes: RegExp[] }} rules
 * @returns {{ keep: boolean, matched: string[], reason: string }}
 */
export function applyFilter(entry, source, { matcher, excludes }) {
  if (isExcluded(entry.title, excludes)) return { keep: false, matched: [], reason: 'excluded' };
  if ((source.filter || 'none') === 'none') return { keep: true, matched: [], reason: 'unconditional' };
  const inTitle = matchKeywords(entry.title, matcher);
  const inBody = matchKeywords(entry.text || '', matcher);
  const total = inTitle.count + inBody.count;
  const matched = matcher.order.filter((k) => inTitle.matched.includes(k) || inBody.matched.includes(k));
  if (inTitle.count > 0) return { keep: true, matched, reason: 'title' };
  if (total >= 2) return { keep: true, matched, reason: 'body' };
  return { keep: false, matched, reason: 'no-match' };
}
