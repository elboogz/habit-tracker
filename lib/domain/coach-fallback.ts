// Phase 5, Step 5 Part 2 (docs/phase-5-plan.md section 4.4 `lib/domain/coach-fallback.ts` and
// section 6.5 "Fallback coaching mode"): the closed, deterministic fallback message set and its
// selection, satisfying `coach-orchestration.ts`'s `FallbackProvider` boundary. No Anthropic call,
// no statistics, no behavioural claim about the user -- each message was reviewed against
// CLAUDE.md's variation-contract rule 1 individually; a sixth "return rather than continue" theme
// was excluded because even a history-neutral rewrite still implied a possible lapse through
// implicature (recorded in full in the plan).
//
// Seed resolution [Ruled, amended -- docs/phase-5-plan.md section 6.5 "Cross-kind fallback
// collision"]. CLAUDE.md's variation-contract rule 2 specifies "habit id plus day key" for a
// per-habit surface, where the entity being varied is the habit. This fallback is account-level
// coaching output -- one message per coaching request, covering the whole habit set
// (`buildCoachFacts(habits: Habit[], ...)`), not a per-habit sentence -- so there is no canonical
// habit id available when fallback fires. The original ruling resolved the base seed to `userId +
// dayKey`, which remains correct and unchanged: it is still the sole account/day variation
// mechanism, exactly as originally ruled. Live acceptance testing (2026-09-14) exposed a case that
// ruling did not contemplate: `nudge` and `weekly`/`monthly` can both fall back for the same
// account on the same day and be displayed together on one Progress screen. A first attempt mixed
// `kind` directly into the hashed seed (`userId|dayKey|kind`); proven insufficient by direct
// search against this implementation (52% cross-kind collision rate across 30,000 sampled
// account/day pairs, matching the rate three independent draws into five buckets would produce --
// hashing kind in only re-randomises the outcome, it does not decorrelate it). The corrected
// design keeps the base hash exactly as originally ruled and adds a fixed, unique offset per
// `kind` afterward (`KIND_OFFSETS` below) -- with `FALLBACK_MESSAGES.length` (5) at least the
// number of `CoachFactsKind` values (3) and each kind's offset distinct modulo that length, the
// three kinds' final indices are pairwise distinct for every possible base, unconditionally: a
// proof, not a statistical property (see `coach-fallback.test.ts`'s exhaustive offset-invariant
// tests, which check this directly rather than only sampling hash outputs). `nudge`'s offset is 0,
// so its formula is byte-identical to the original pre-amendment ruling. The fixed relative
// relationship this creates between kinds shown together (always `N`, `N+1`, `N+2` modulo 5 for
// whatever `N` the day's hash produces) is consciously accepted: the message order is never shown
// to a user, so this relationship has no realistic path to being perceived, and a second
// permutation layer to also vary it would add real complexity for no observable benefit.
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

/**
 * Fixed, unique offset per `CoachFactsKind`, applied to the account/day base index (see the
 * seed-resolution note above). Typed as `Record<CoachFactsKind, number>` deliberately: adding a
 * fourth `CoachFactsKind` member without revisiting this map is a compile error, not a silent gap
 * in the distinctness guarantee. `nudge: 0` is what makes `nudge`'s selection byte-identical to
 * the original pre-amendment formula.
 */
export const KIND_OFFSETS: Record<CoachFactsKind, number> = {
  nudge: 0,
  weekly: 1,
  monthly: 2,
};

/**
 * Deterministic index into `FALLBACK_MESSAGES` for a given account, day, and insight kind.
 * `baseIndex` is exactly the original pre-amendment formula (`userId + dayKey`, hashed and
 * reduced mod the message count); `kind` only ever contributes via `KIND_OFFSETS`'s fixed
 * additive offset, never by entering the hash input.
 */
export function selectFallbackIndex(userId: string, dayKey: string, kind: CoachFactsKind): number {
  const baseIndex = fnv1a32(`${userId}|${dayKey}`) % FALLBACK_MESSAGES.length;
  return (baseIndex + KIND_OFFSETS[kind]) % FALLBACK_MESSAGES.length;
}

/**
 * Builds a `FallbackProvider` (the boundary `coach-orchestration.ts` defines) closed over the
 * caller's `userId` and `today` day key -- see the seed-resolution note above for why both are
 * supplied here rather than read off `facts`/`kind`. The returned function still ignores its own
 * `facts` parameter: which habits triggered fallback never affects selection. It no longer ignores
 * `kind` (amended, see the seed-resolution note above): the same account and day now selects a
 * guaranteed-distinct message per kind, so `nudge` and `weekly`/`monthly` can never show identical
 * text when both fall back and are displayed together.
 */
export function buildFallbackProvider(userId: string, today: string): FallbackProvider {
  return (_facts: CoachFacts, kind: CoachFactsKind): string => FALLBACK_MESSAGES[selectFallbackIndex(userId, today, kind)];
}
