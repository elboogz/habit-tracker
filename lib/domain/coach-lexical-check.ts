// Phase 5, Step 5 (docs/phase-5-plan.md section 6.4): a separate, narrow lexical backstop for the
// class of failure the numeric validator structurally cannot see -- domain-internal enum values
// echoed as user-facing labels, and the small set of loss/streak framings CLAUDE.md's copy
// contract already names as prohibited. Deliberately not part of lib/domain/coach-validation.ts
// and does not modify it: the numeric validator's job (deterministic numeral grounding) and this
// check's job (a closed set of forbidden literal strings) are different concerns, and keeping them
// apart keeps neither one's intentional leniency or strictness bleeding into the other -- in
// particular, coach-validation.ts's deliberate bare-integer/percent/decimal equivalence (which is
// what let "recovery rate of 55" through, correctly, as a numeric-grounding matter) is untouched
// by this file.
//
// Deliberately not a general content-safety or tone classifier. Case-insensitive, whole-word
// matching over a fixed, closed list -- not substring containment: each entry is matched only when
// it appears as a complete word (\b<phrase>\b), so "rebuilding" does not spuriously match a listed
// "building" (there is no word boundary between "re" and "building"). No stemming, no fuzzy
// matching, no synonym expansion, no semantic interpretation of any kind. A paraphrase that means
// the same thing but uses none of these literal strings passes silently; this is a named, accepted
// residual risk (see coach-lexical-check.test.ts's "known accepted residual" case, and
// docs/phase-5-plan.md section 10), not a gap this module claims to close.
//
// PROHIBITED_LEXICON sources, exhaustively -- every entry traces to one of two origins, and
// nothing else was added on judgment call:
//
// - "protecting", "breaking", "losing", "keeping alive", "getting back on track", "streak",
//   "don't": CLAUDE.md's user-facing copy variation contract, rule 1's own prohibited-framings
//   sentence ("Prohibited framings include protecting, breaking, losing, keeping alive, getting
//   back on track, streak language, absence day-counts, and "don't""). "streak" is the literal
//   word underlying that sentence's "streak language" entry. "absence day-counts" is deliberately
//   NOT included: it names a numeric/semantic constraint (never state how many days were missed),
//   not a specific string -- and CoachFacts never supplies the model a days-missed count in the
//   first place, so there is nothing of that shape for a lexical check to catch.
// - "insufficient_data", "recovering", "rebuilding", "thriving": four of MomentumStateKey's seven
//   values (./momentum.ts). "building", "steady", and "quiet" were removed after the corrected
//   3a.2 rerun (90 calls, revised 12-rule prompt + this checker together): 22 of 23 lexical
//   rejections were confirmed conservative false positives, and "steady" alone -- an ordinary
//   English word that never once appeared as an actual momentumState or habitHealth value in any
//   of the six measurement fixtures -- caused 20 of them by construction (there was nothing
//   "steady" in the data for the model to be leaking). "building" produced 2 confirmed false
//   positives (matched in fixtures whose real value was "thriving" and "rebuilding", not
//   "building") against 2 remaining ambiguous instances, well past the point of being a broad,
//   ordinary-English liability rather than a useful check. "quiet" produced zero evidence either
//   way in that run (it never fired), but shares the identical structural problem -- an ordinary
//   English word a word-boundary check cannot distinguish from genuine leakage -- and was removed
//   pre-emptively rather than kept until it produced its own predictable false-positive case.
//   "recovering", "rebuilding", and "thriving" are kept: less ordinary as English, and the 3a.2
//   rerun produced zero false positives (and zero confirmed leaks) for any of the three, so there
//   is no observed problem to act on yet.
// - "insufficient_evidence", "no_positive_recent_comparison", "positive_recent_comparison": every
//   HabitHealthVerdict value (./habit-health.ts). Never fired, genuine or false-positive, across
//   the 3a.2 rerun; kept on the reasoning that their machine-shaped snake_case form is very
//   unlikely to appear in ordinary coaching prose innocently.
//
// Deliberately excluded: LapseReasonDistributionKey's six keys (too_busy, forgot, low_energy,
// not_feeling_it, something_else, skipped_without_reason). No observed leak, and the prompt's own
// rule already governs lapse reasons by count and topic, not by asking the model to read or repeat
// a key name -- there is no adjacent, structurally-forced exposure to the raw key the way
// momentumState/habitHealth sit directly in the payload the model reads from. Revisit only if
// evidence shows otherwise.
//
// Residual, recorded rather than compensated for (docs/phase-5-plan.md section 10): for
// "building", "steady", and "quiet", literal enum leakage is no longer mechanically blocked by
// anything. The prompt's rule 7 ("never write the literal value of momentumState... as a label")
// is the sole remaining control for those three values, and its effectiveness has not been
// independently demonstrated -- the leakage observed in the first (nine-rule) measurement predates
// rule 7's existence, and the corrected rerun exercised the revised prompt and this checker
// together, so it cannot isolate what rule 7 alone would or would not catch. Do not read the
// corrected rerun's clean numeric/lexical result as evidence that rule 7 suppresses leakage of
// these three values on its own -- it was never tested in isolation. Do not close this by adding
// semantic validation, contextual parsing, synonym detection, or another model call; it is an
// accepted MVP residual, revisited only if evidence (a future measurement isolating rule 7, or a
// live report) says otherwise.
import type { MomentumStateKey } from './momentum';
import type { HabitHealthVerdict } from './habit-health';

const CLAUDE_MD_PROHIBITED_FRAMINGS = ['protecting', 'breaking', 'losing', 'keeping alive', 'getting back on track', 'streak', "don't"] as const;

const MOMENTUM_STATE_VALUES: readonly MomentumStateKey[] = ['insufficient_data', 'recovering', 'rebuilding', 'thriving'];

const HABIT_HEALTH_VALUES: readonly HabitHealthVerdict[] = ['insufficient_evidence', 'no_positive_recent_comparison', 'positive_recent_comparison'];

/** The complete, closed set of prohibited literal strings. See the module header for exact provenance of every entry, and for why "building", "steady", and "quiet" were removed. */
export const PROHIBITED_LEXICON: readonly string[] = [...CLAUDE_MD_PROHIBITED_FRAMINGS, ...MOMENTUM_STATE_VALUES, ...HABIT_HEALTH_VALUES];

export type LexicalCheckResult = { valid: true } | { valid: false; matchedPhrases: string[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Precisely: whole-word matching over a fixed list, not substring containment. Each entry is
 * matched only when it appears as a complete word (\b<phrase>\b) -- e.g. "streak" does not match
 * inside "streaking" (no word boundary between "streak" and "ing"), pinned directly in the test
 * file. This is a different, narrower rule than plain substring search would be, and is described
 * exactly that way rather than loosely as "substring matching": the boundary anchor is a syntactic
 * distinction (whole word vs. part of a longer one), still no stemming, no fuzzy distance, no
 * semantic reasoning of any kind. For every remaining entry it still cannot distinguish an
 * ordinary, harmless use of the word from a genuine leak of that literal value -- that residual
 * false-positive exposure is a known, accepted trade-off of a closed-list check, not an oversight,
 * and is why "building", "steady", and "quiet" were removed after being measured, not guessed at.
 */
export function checkProhibitedLexicon(text: string): LexicalCheckResult {
  const matchedPhrases: string[] = [];
  for (const phrase of PROHIBITED_LEXICON) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
    if (pattern.test(text)) matchedPhrases.push(phrase);
  }
  return matchedPhrases.length === 0 ? { valid: true } : { valid: false, matchedPhrases };
}
