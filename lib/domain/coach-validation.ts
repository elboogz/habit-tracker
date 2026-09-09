// Phase 5, Step 2 part 2 (docs/phase-5-plan.md section 6.4): a deterministic numeric grounding
// safeguard, not a semantic entailment system. Its whole job is to answer one narrow question --
// does every number describing the user's behaviour in `text` appear in the enumerable set of
// numeric leaves `facts` actually carries? -- and nothing broader than that.
//
// This module has no dependency on any domain module beyond `coach-facts.ts`'s own type and its
// co-located `RATE_FIELD_NAMES` constant -- a declaration of which fields the CoachFacts schema
// itself treats as rate-shaped, not a computed behavioural fact. It never calls buildCoachFacts,
// never reads habits/logs/schedulePeriods/lapseReasons, and never recomputes a behavioural fact of
// its own: `facts` must be the exact object the corresponding coaching generation path was given,
// so validation and generation are always checked against one shared source of truth rather than
// two independently derived ones (docs/phase-5-plan.md's "Validator authority").
//
// What is validated: percentages, whole counts, and durations (including Recovery Time -- not
// generically exempt just because it names a unit), each checked as an exact match against the
// canonical, already-rounded rendering `lib/domain/coach-facts.ts` produced, plus the three
// mutually-equivalent renderings of any rate-shaped fact named in `coach-facts.ts`'s explicit
// `RATE_FIELD_NAMES` list: "82%", "82", and "0.82" all stand for the same underlying fact and are
// all accepted; "81%"/"83%" are not, because rounding happens once at construction time (see
// coach-facts.ts) and this module does no further fuzzy matching of its own. Narrow, deterministic
// exceptions exist only for ISO dates, month-plus-day dates, and digit-form ordinals ("21st") --
// never for a bare unit word like "days" or "%", which must never by itself exempt a number from
// being checked.
//
// What is not validated, by design: any non-numeric characterisation ("you have recovered more
// than half the time"), and any number written out in words rather than digits ("three days") --
// see the residual-risk register in docs/phase-5-plan.md section 10 and the KNOWN ACCEPTED
// RESIDUAL tests in this module's own test file. No semantic entailment, no natural-language
// number parsing, is built here, and none should be added to close either gap; the plan's own
// prompt rule ("write behavioural numbers as digits") is the sanctioned defence-in-depth for the
// second, and general characterisation validation is explicitly out of scope for Phase 5.
import { RATE_FIELD_NAMES, type CoachFacts, type HabitCoachFacts } from './coach-facts';

const RATE_FIELD_NAME_SET: ReadonlySet<string> = new Set(RATE_FIELD_NAMES);

export type ValidationResult = { valid: true } | { valid: false; invalidNumerals: string[] };

/** Digit-form ordinals: "1st", "21st", "3rd", "4th". Masked before the main numeral scan runs, regardless of whether they sit inside a date phrase or stand alone. */
const ORDINAL_RE = /\b\d{1,2}(?:st|nd|rd|th)\b/gi;

/** ISO-shaped dates, e.g. "2026-03-05". */
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const MONTH_NAMES =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** "March 3", "March 3rd" (the ordinal suffix, if present, is masked separately by ORDINAL_RE first). */
const MONTH_DAY_RE = new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi');

/** "3 March", "the 3rd of March". */
const DAY_MONTH_RE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})\\b`, 'gi');

/** Every remaining digit-form numeral, with an optional decimal component and an optional trailing percent sign, after date/ordinal spans have been masked out. */
const NUMERAL_RE = /\d+(?:\.\d+)?%?/g;

/**
 * Replaces every exempt span with `#` characters of the same length, so positions are preserved
 * (irrelevant here, but avoids any accidental re-matching across a shortened string) and none of
 * the masked digits reach `NUMERAL_RE`. Order matters: ordinals are masked last so a month-day
 * date's own trailing ordinal ("March 3rd") is still fully covered by the date regex first, with
 * the ordinal mask only needed for a bare, non-date ordinal like "your 3rd attempt".
 */
function maskExemptSpans(text: string): string {
  return text
    .replace(ISO_DATE_RE, (match) => '#'.repeat(match.length))
    .replace(MONTH_DAY_RE, (match) => '#'.repeat(match.length))
    .replace(DAY_MONTH_RE, (match) => '#'.repeat(match.length))
    .replace(ORDINAL_RE, (match) => '#'.repeat(match.length));
}

/**
 * Every numeric leaf in `facts`, split into two sets by `coach-facts.ts`'s explicit, type-checked
 * `RATE_FIELD_NAMES` list (not a `.endsWith('Pct')` naming-convention check -- see that constant's
 * own doc comment for why the explicit list is the safer of the two): a field named there is
 * rate-shaped and carries the three-way percent/decimal/bare equivalence; every other numeric leaf
 * (counts, durations) is checked only at face value. This is otherwise a generic walk over
 * `HabitCoachFacts`' own leaves plus one level of nesting for `lapseReasonCounts`, not a
 * hand-maintained field list -- it stays correct if a non-rate field is added or removed from
 * `coach-facts.ts` without this module changing, and a compile error (not a silent behavioural
 * change) if `RATE_FIELD_NAMES` itself ever drifts from the type it's declared against.
 */
function collectFactNumbers(facts: CoachFacts): { plain: Set<number>; pct: Set<number> } {
  const plain = new Set<number>();
  const pct = new Set<number>();

  for (const habitFacts of facts.habits) {
    for (const [key, value] of Object.entries(habitFacts) as [keyof HabitCoachFacts, unknown][]) {
      if (typeof value === 'number') {
        (RATE_FIELD_NAME_SET.has(key) ? pct : plain).add(value);
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const nested of Object.values(value as Record<string, unknown>)) {
          if (typeof nested === 'number') plain.add(nested);
        }
      }
    }
  }

  return { plain, pct };
}

/**
 * Whether the numeral `raw` (as it literally appeared in the text, after `%` stripping and
 * decimal parsing) is grounded in `facts`. Percent claims are checked only against rate-shaped
 * ("*Pct") facts, by exact equality against their single canonical rounded value -- not a range,
 * so "81%"/"83%" against an 82 fact are both rejected, not merely "far" values. A bare number is
 * checked three ways: as an exact plain fact, as the bare-integer rendering of a `*Pct` fact
 * ("82" standing for "82%"), or as the decimal rendering of one ("0.82" standing for "82%") -- the
 * same "0.82 <-> 82% <-> 82" equivalence the plan names, expanded outward from a single stored
 * canonical value rather than the model being handed multiple pre-computed renderings.
 */
function isGrounded(value: number, isPercent: boolean, facts: { plain: Set<number>; pct: Set<number> }): boolean {
  if (isPercent) {
    return facts.pct.has(Math.round(value));
  }
  if (facts.plain.has(value)) return true;
  if (Number.isInteger(value) && value >= 0 && value <= 100 && facts.pct.has(value)) return true;
  if (value >= 0 && value <= 1 && facts.pct.has(Math.round(value * 100))) return true;
  return false;
}

/**
 * Deterministic numeric grounding: every digit-form numeral in `text` (outside a recognised date
 * or ordinal) must equal, under the equivalences above, some numeric leaf of `facts`. `facts` must
 * be the same `CoachFacts` object the corresponding generation call was given -- this function
 * never derives or recomputes facts of its own, so it cannot silently drift from what the model
 * actually saw.
 */
export function validateCoachOutput(text: string, facts: CoachFacts): ValidationResult {
  const factNumbers = collectFactNumbers(facts);
  const masked = maskExemptSpans(text);
  const invalidNumerals: string[] = [];

  for (const match of masked.matchAll(NUMERAL_RE)) {
    const raw = match[0];
    const isPercent = raw.endsWith('%');
    const value = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw);

    if (!isGrounded(value, isPercent, factNumbers)) invalidNumerals.push(raw);
  }

  return invalidNumerals.length === 0 ? { valid: true } : { valid: false, invalidNumerals };
}
