// Phase 5, Step 5 Part 2 (docs/phase-5-plan.md section 4.4 `lib/domain/coach-fallback.ts` and
// section 6.5 "Fallback coaching mode"): the closed, deterministic fallback message set and its
// selection, satisfying `coach-orchestration.ts`'s `FallbackProvider` boundary. No Anthropic call,
// no statistics, no behavioural claim about the user -- each message was reviewed against
// CLAUDE.md's variation-contract rule 1 individually; a sixth "return rather than continue" theme
// was excluded because even a history-neutral rewrite still implied a possible lapse through
// implicature (recorded in full in the plan).
//
// Seed resolution [Ruled]. CLAUDE.md's variation-contract rule 2 specifies "habit id plus day
// key" for a per-habit surface, where the entity being varied is the habit. This fallback is
// account-level coaching output -- one message per coaching request, covering the whole habit set
// (`buildCoachFacts(habits: Habit[], ...)`), not a per-habit sentence -- so there is no canonical
// habit id available when fallback fires. The seed resolves to the entity the output is actually
// about: `userId + dayKey`. Neither value lives on `CoachFacts`, and `FallbackProvider`'s own
// signature (`(facts, kind) => string`) deliberately doesn't carry them either, so both are
// supplied to `buildFallbackProvider` at construction time via closure rather than widening
// `CoachFacts` or the provider type.
import type { CoachFacts, CoachFactsKind } from './coach-facts';
import type { FallbackProvider } from './coach-orchestration';

/**
 * The closed, approved set of five fallback messages (docs/phase-5-plan.md section 6.5). Order
 * only fixes each message's index for `selectFallbackIndex` -- it carries no ranking or priority
 * meaning. Each string is the exact wording approved in the copy-gate review; do not add, remove,
 * reword, or normalise punctuation in any entry without a separate copy-gate review.
 */
export const FALLBACK_MESSAGES: readonly string[] = [
  'Pick the smallest possible first step, and just do that one thing.',
  'Changing the time, place, or setup this happens in can make it noticeably easier to do.',
  'Pairing this with something you already do every day can make it easier to remember.',
  'A smaller version of this still counts. There is no need for all or nothing.',
  'Putting a visible reminder where you will actually see it often works better than willpower.',
];

/**
 * FNV-1a, 32-bit (approved docs/phase-5-plan.md section 6.5): pure arithmetic, no library, runs
 * identically under Hermes (client) and Deno (Edge Functions). Chosen over an earlier djb2/XOR
 * candidate because FNV-1a XORs each byte in before multiplying, mixing every byte's influence
 * through the remaining hash state rather than leaving a constant offset between structurally
 * similar inputs -- verified directly against the adversarial case that broke the djb2 candidate
 * (two ids differing by a constant per-character offset collided on every one of 30 days under
 * djb2; 5 of 30 under FNV-1a, in line with random chance for 5 buckets), and against a
 * 2,000-random-UUID sample showing no bucket skew. No cryptographic property is claimed or
 * required -- only even bucket distribution and freedom from that specific collision pattern.
 * Matches the canonical published FNV-1a 32-bit test vectors (pinned in coach-fallback.test.ts).
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (the FNV prime), expressed as shifts/adds to stay in 32-bit integer
    // arithmetic without overflowing to a float -- identical result to Math.imul(hash, 16777619).
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic index into `FALLBACK_MESSAGES` for a given account and day. */
export function selectFallbackIndex(userId: string, dayKey: string): number {
  return fnv1a32(`${userId}|${dayKey}`) % FALLBACK_MESSAGES.length;
}

/**
 * Builds a `FallbackProvider` (the boundary `coach-orchestration.ts` defines) closed over the
 * caller's `userId` and `today` day key -- see the seed-resolution note above for why both are
 * supplied here rather than read off `facts`/`kind`. The returned function ignores its own
 * `facts`/`kind` parameters: selection depends only on which account and which day this is, never
 * on the specific reason fallback fired, so the same account always sees the same message on a
 * given day regardless of which habits or kind triggered it.
 */
export function buildFallbackProvider(userId: string, today: string): FallbackProvider {
  return (_facts: CoachFacts, _kind: CoachFactsKind): string => FALLBACK_MESSAGES[selectFallbackIndex(userId, today)];
}
