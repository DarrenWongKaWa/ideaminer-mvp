/**
 * idea-search.js
 * ------------------------------------------------------------
 * Keyword-based idea search over the mock-ideas dataset.
 *
 * The MVP path is deliberately simple: tokenization + word-boundary
 * substring matching with a small weighted score, plus a stop-word
 * list and a minimum-score threshold to keep common English words
 * ("the", "and", "of", "in", "is", "no", "here", ...) from triggering
 * false-positive matches.
 *
 * The three-layer defence is:
 *   1. tokenizeQuery drops a fixed list of English stop-words
 *      (~80 words) before scoring, in addition to the existing
 *      length-< 2 and dedup filters.
 *   2. scoreIdea uses \b<token>\b word-boundary regex match (with a
 *      safe escape) instead of String.includes(), so "no" no longer
 *      matches "non-equilibrium" or "nonlinear" as a substring.
 *   3. bestMatch applies a minimum-score threshold of
 *      `max(2, tokens.length)` so a single weak hit is not enough,
 *      and a long query of mostly-junk tokens needs a proportionally
 *      stronger signal to count.
 *
 * Together these guarantee that the empty-state path is reachable
 * for realistic user input: a query that survives the stop-word
 * filter must contain at least one content word, and that word must
 * hit question / background / significance / methods hard enough to
 * cross the threshold.
 *
 * All three exports are pure functions; no DOM, no async.
 *
 * Scoring rule (per token, with word-boundary match):
 *   +3   matches as a whole word in `question`
 *   +2   matches as a whole word in `background` OR `significance`
 *   +1   matches as a whole word in any of `methods[i]`
 *   +1   (bonus) matches as a whole word in `field`
 *
 * The total score is the sum across all tokens. An idea with score
 * < 2 is considered "no match". The best match is the idea with the
 * highest total score; ties are broken by the first occurrence in
 * the input array (i.e. by the order the user wrote them down in).
 * ------------------------------------------------------------
 */

/**
 * @typedef {Object} SearchQuery
 * @property {string} raw       The raw user input (trimmed)
 * @property {string[]} tokens  Lowercased, deduplicated, length>=2,
 *                              stop-word-filtered tokens
 */

/**
 * English stop-words: a fixed set of common words that carry too
 * little semantic content to drive a search match. Lowercase, ASCII.
 * Kept short and conservative — only words that are virtually
 * never meaningful on their own in a research-query context.
 */
const STOP_WORDS = new Set([
  // articles, demonstratives
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // conjunctions
  'and', 'or', 'but', 'if', 'so', 'yet', 'for', 'nor',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'as', 'into',
  'about', 'up', 'out', 'off', 'over', 'under', 'via', 'per',
  // pronouns
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'she', 'it',
  'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  // auxiliary / copular verbs
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must',
  // common adverbs / negatives
  'no', 'not', 'yes', 'nor',
  'here', 'there', 'where', 'when', 'why', 'how',
  'all', 'any', 'some', 'more', 'most', 'few', 'many', 'much',
  'such', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
  'also', 'then', 'now', 'even', 'still', 'ever', 'never',
  'what', 'which', 'who', 'whom', 'whose',
  // research-query noise words
  'match', 'find', 'want', 'need', 'look', 'search', 'show', 'give',
  'get', 'see', 'use', 'using', 'used',
]);

/**
 * Compute the minimum total score for an idea to be considered a
 * "match", given a token list of length N.
 *
 *   min_score = max(2, N)
 *
 * Rationale: a single weak hit (one token in `methods` or `field`
 * for +1) should not count, so the floor is 2. But as the query
 * gets longer with mostly-junk tokens, the score must keep up —
 * otherwise "abc def ghi jkl" (4 tokens) would still match a real
 * idea if one of those tokens happened to appear as a substring.
 * With max(2, N), a 4-token query needs a score of at least 4 to
 * be a real match, which catches the gibberish case while
 * preserving good behaviour for ordinary queries.
 *
 * @param {number} tokenCount
 * @returns {number}
 */
function minMatchScore(tokenCount) {
  return Math.max(2, tokenCount);
}

/**
 * Tokenize a search query.
 * - Lowercase
 * - Split on non-word characters
 * - Drop tokens with length < 2
 * - Drop English stop-words (the fixed STOP_WORDS list above)
 * - Deduplicate
 * @param {string} raw
 * @returns {SearchQuery}
 */
export function tokenizeQuery(raw) {
  const trimmed = (raw == null ? '' : String(raw)).trim();
  if (!trimmed) return { raw: '', tokens: [] };
  const seen = new Set();
  const tokens = [];
  for (const t of trimmed.toLowerCase().split(/\W+/u)) {
    if (t.length < 2) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return { raw: trimmed, tokens };
}

/**
 * Escape a string for safe use inside a RegExp body.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher (token -> RegExp) used by scoreIdea.
 * ASCII alphanumeric tokens get a \b...\b word-boundary match;
 * other tokens (Unicode, mixed) fall back to a plain substring
 * match (escaped), since JS \b is word-character based and would
 * over- or under-match on non-ASCII input.
 * The `i` flag is required because the haystacks (idea.question,
 * idea.background, etc.) are kept in their original case; the tokens
 * are already lowercased in tokenizeQuery.
 * @param {string} tok
 * @returns {RegExp}
 */
function tokenMatcher(tok) {
  const esc = escapeRegex(tok);
  if (/^[a-z0-9]+$/.test(tok)) {
    return new RegExp('\\b' + esc + '\\b', 'i');
  }
  return new RegExp(esc, 'i');
}

/**
 * Score one idea against a tokenized query.
 * Returns 0 if the query has no tokens or no token matches.
 * @param {{
 *   field?: string,
 *   question?: string,
 *   background?: string,
 *   significance?: string,
 *   methods?: string[]
 * }} idea
 * @param {SearchQuery} query
 * @returns {number}
 */
export function scoreIdea(idea, query) {
  if (!idea || !query || !Array.isArray(query.tokens) || query.tokens.length === 0) {
    return 0;
  }
  const field = String(idea.field || '');
  const question = String(idea.question || '');
  const background = String(idea.background || '');
  const significance = String(idea.significance || '');
  const methods = Array.isArray(idea.methods) ? idea.methods : [];

  let score = 0;
  for (const tok of query.tokens) {
    if (!tok) continue;
    const re = tokenMatcher(tok);
    if (re.test(question)) {
      score += 3;
    }
    if (re.test(background)) {
      score += 2;
    } else if (re.test(significance)) {
      score += 2;
    }
    if (methods.some((m) => re.test(String(m || '')))) {
      score += 1;
    }
    if (re.test(field)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Find the best-matching idea for a query.
 * Returns null if the query is empty OR if the best score is below
 * `max(2, tokens.length)` — a single weak hit is not enough, and a
 * long query of mostly-junk tokens needs a proportionally stronger
 * signal to count.
 * @param {Array} ideas
 * @param {string} rawQuery
 * @returns {{idea: object, score: number} | null}
 */
export function bestMatch(ideas, rawQuery) {
  const query = tokenizeQuery(rawQuery);
  if (!Array.isArray(ideas) || ideas.length === 0) return null;
  if (query.tokens.length === 0) return null;

  const minScore = minMatchScore(query.tokens.length);

  let best = null;
  let bestScore = 0;
  for (const idea of ideas) {
    const s = scoreIdea(idea, query);
    if (s > bestScore) {
      bestScore = s;
      best = idea;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { idea: best, score: bestScore };
}

/* ------------------------------------------------------------------
 * Optional: chip-level scoring (unused by bestMatch, kept for future
 * UI affordances like "Matched: topological · moire · 1.08°").
 * ------------------------------------------------------------------ */
export function matchedFields(idea, query) {
  if (!idea || !query) return [];
  const field = String(idea.field || '');
  const question = String(idea.question || '');
  const background = String(idea.background || '');
  const significance = String(idea.significance || '');
  const methods = Array.isArray(idea.methods) ? idea.methods : [];
  const out = [];
  for (const tok of query.tokens) {
    const re = tokenMatcher(tok);
    if (re.test(question)
        || re.test(background) || re.test(significance)
        || methods.some((m) => re.test(String(m || '')))
        || re.test(field)) {
      out.push(tok);
    }
  }
  return Array.from(new Set(out));
}
