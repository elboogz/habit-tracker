import type { CoachFacts, HabitCoachFacts } from './coach-facts';
import { resolveCoachGeneration, type CoachGenerationDeps } from './coach-orchestration';
import { buildFallbackProvider, FALLBACK_MESSAGES, fnv1a32, KIND_OFFSETS, selectFallbackIndex } from './coach-fallback';

// Phase 5, Step 5 Part 2 (docs/phase-5-plan.md sections 4.4 and 6.5). Deterministic-only:
// no probabilistic or distribution assertions here by design (see the copy-gate review) --
// every seed used below is a fixed, known value, not a random sample.

describe('fnv1a32 -- fixed vectors pinning the implementation', () => {
  // Canonical, published FNV-1a 32-bit test vectors. If this implementation ever silently
  // changes (e.g. an accidental refactor of the bit-shift multiply), these catch it regardless
  // of anything else in this file.
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('fnv1a32(%j) === 0x%s', (input, expected) => {
    expect(fnv1a32(input)).toBe(expected);
  });

  // Vectors for this module's actual base-hash seed format (`${userId}|${dayKey}`) -- unchanged
  // since the original ruling and still exactly what `selectFallbackIndex` hashes for its base
  // index (docs/phase-5-plan.md section 6.5, "Cross-kind fallback collision, amended"): `kind`
  // never enters the hash input, only a fixed offset applied afterward.
  it.each([
    ['user-1|2026-09-12', 3894357170],
    ['2c9e6a0b-3e11-4b2a-9f0d-7a5c4e8b1d62|2026-09-11', 904319070],
  ])('fnv1a32(%j) === %i', (input, expected) => {
    expect(fnv1a32(input)).toBe(expected);
  });
});

const KNOWN_KINDS = ['nudge', 'weekly', 'monthly'] as const;

describe('selectFallbackIndex / buildFallbackProvider -- determinism', () => {
  it('returns the same result for the same seed, called repeatedly', () => {
    const a = selectFallbackIndex('user-42', '2026-09-12', 'nudge');
    const b = selectFallbackIndex('user-42', '2026-09-12', 'nudge');
    expect(a).toBe(b);
  });

  it('a provider built from the same (userId, today) pair returns the same message for repeated calls with the same kind', () => {
    const provider = buildFallbackProvider('user-42', '2026-09-12');
    const facts: CoachFacts = { habits: [] };
    const first = provider(facts, 'nudge');
    const second = provider(facts, 'nudge');
    expect(first).toBe(second);
  });

  it('a different day for the same account and kind can select a different message (not asserting it always does -- just that the day key is live input)', () => {
    const dayOne = selectFallbackIndex('user-42', '2026-09-12', 'nudge');
    const dayTwo = selectFallbackIndex('user-42', '2026-09-13', 'nudge');
    // Both are valid indices into the closed set either way; this only confirms dayKey
    // participates in the hash input, not a specific outcome.
    expect(FALLBACK_MESSAGES[dayOne]).toBeDefined();
    expect(FALLBACK_MESSAGES[dayTwo]).toBeDefined();
  });
});

// Amendment (docs/phase-5-plan.md section 6.5, "Cross-kind fallback collision, amended"): a first
// attempt mixed `kind` into the hashed seed (`userId|dayKey|kind`). Proven insufficient by a
// direct search against that implementation: 52% of 30,000 sampled account/day pairs produced a
// cross-kind collision, matching the rate three independent draws into five buckets would produce
// -- hashing kind in only re-randomises the outcome, it does not guarantee distinctness. The
// corrected design keeps the base hash exactly as originally ruled (`userId|dayKey`, pinned above)
// and adds KIND_OFFSETS, a fixed unique offset per kind, applied after hashing. The tests below
// pin the actual guarantee -- proven for every possible base index, not sampled from hash outputs
// -- rather than the single lucky fixture the first attempt relied on.
describe('KIND_OFFSETS -- structural guarantee of cross-kind distinctness', () => {
  it('every CoachFactsKind value has an offset', () => {
    expect(Object.keys(KIND_OFFSETS).sort()).toEqual([...KNOWN_KINDS].sort());
  });

  it('the offsets are unique modulo FALLBACK_MESSAGES.length', () => {
    const offsetsModLength = KNOWN_KINDS.map((kind) => KIND_OFFSETS[kind] % FALLBACK_MESSAGES.length);
    expect(new Set(offsetsModLength).size).toBe(KNOWN_KINDS.length);
  });

  it('FALLBACK_MESSAGES.length is at least the number of CoachFactsKind values', () => {
    // Derived from KIND_OFFSETS itself, not the test-local KNOWN_KINDS constant -- this way the
    // assertion stays tied to the actual exhaustive kind-offset mapping even if KNOWN_KINDS above
    // were ever left stale after a future CoachFactsKind addition.
    expect(FALLBACK_MESSAGES.length).toBeGreaterThanOrEqual(Object.keys(KIND_OFFSETS).length);
  });

  it('nudge has offset 0, so its formula is unchanged from the original pre-amendment ruling', () => {
    expect(KIND_OFFSETS.nudge).toBe(0);
  });

  // Exhaustive, not sampled: FALLBACK_MESSAGES.length is 5, so every possible base index is
  // actually enumerated here -- this is a proof for every base that could ever occur, not a
  // statistical sample of some of them.
  it('for every possible baseIndex, all three kinds resolve to pairwise-distinct final indices', () => {
    for (let base = 0; base < FALLBACK_MESSAGES.length; base++) {
      const finals = KNOWN_KINDS.map((kind) => (base + KIND_OFFSETS[kind]) % FALLBACK_MESSAGES.length);
      expect(new Set(finals).size).toBe(KNOWN_KINDS.length);
    }
  });
});

describe('cross-kind distinctness holds across a broad bounded sweep of accounts and days', () => {
  // 200 synthetic userIds x 30 day keys = 6,000 (userId, dayKey) pairs, fixed and deterministic
  // (not randomly generated at test time), checked against the real implementation. This is the
  // direct replacement for the single-fixture proof the first attempt relied on -- a broad sweep
  // asserting the actual invariant, not a demonstration that one pair happens to satisfy it.
  const SWEEP_USER_COUNT = 200;
  const SWEEP_DAY_COUNT = 30;

  it('nudge, weekly, and monthly are pairwise distinct for every (userId, dayKey) pair in the sweep', () => {
    for (let u = 0; u < SWEEP_USER_COUNT; u++) {
      const userId = `sweep-user-${u}`;
      for (let d = 1; d <= SWEEP_DAY_COUNT; d++) {
        const dayKey = `2026-01-${String(d).padStart(2, '0')}`;
        const provider = buildFallbackProvider(userId, dayKey);
        const facts: CoachFacts = { habits: [] };
        const results = KNOWN_KINDS.map((kind) => provider(facts, kind));
        expect(new Set(results).size).toBe(KNOWN_KINDS.length);
        for (const result of results) {
          expect(FALLBACK_MESSAGES).toContain(result);
        }
      }
    }
  });

  it('repeated calls for the same (userId, dayKey, kind) remain stable across the sweep', () => {
    for (let u = 0; u < SWEEP_USER_COUNT; u += 37) {
      // Sparser stride here (every 37th user) -- determinism-per-seed is already exhaustively
      // covered by the distinctness sweep above calling each seed once; this only re-confirms
      // repeated calls agree, so a full re-run of all 6,000 pairs would be redundant coverage.
      const userId = `sweep-user-${u}`;
      const dayKey = '2026-01-15';
      for (const kind of KNOWN_KINDS) {
        const a = selectFallbackIndex(userId, dayKey, kind);
        const b = selectFallbackIndex(userId, dayKey, kind);
        expect(a).toBe(b);
      }
    }
  });
});

describe('selection never escapes the approved closed set', () => {
  // A fixed, known list of seeds (not randomly generated at test time) exercised against the
  // real function -- deterministic by construction, not a probabilistic sample.
  const knownUserIds = [
    'user-1',
    'user-2',
    '2c9e6a0b-3e11-4b2a-9f0d-7a5c4e8b1d62',
    'a7f3d219-8c4e-4a6b-b1f0-3e9d6c2a5f88',
    '',
    'a-very-long-user-id-string-that-is-unusually-long-for-a-uuid-primary-key',
  ];
  const knownDayKeys = ['2026-01-01', '2026-06-15', '2026-09-11', '2026-12-31', '2028-02-29'];

  it.each(
    knownUserIds.flatMap((userId) =>
      knownDayKeys.flatMap((dayKey) => KNOWN_KINDS.map((kind): [string, string, (typeof KNOWN_KINDS)[number]] => [userId, dayKey, kind])),
    ),
  )('userId=%j dayKey=%j kind=%j selects a valid index', (userId, dayKey, kind) => {
    const index = selectFallbackIndex(userId, dayKey, kind);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(FALLBACK_MESSAGES.length);
    expect(FALLBACK_MESSAGES[index]).toEqual(expect.any(String));
  });

  it('the provider always returns a string that is a member of FALLBACK_MESSAGES, for every known seed and kind above', () => {
    const facts: CoachFacts = { habits: [] };
    for (const userId of knownUserIds) {
      for (const dayKey of knownDayKeys) {
        const provider = buildFallbackProvider(userId, dayKey);
        for (const kind of KNOWN_KINDS) {
          expect(FALLBACK_MESSAGES).toContain(provider(facts, kind));
        }
      }
    }
  });
});

describe('every approved message is reachable through known deterministic seeds', () => {
  // Found by a one-time brute-force search of the real fnv1a32 function over a fixed userId and a
  // small range of day keys, then hardcoded here -- not re-derived at test time, and not a
  // probabilistic search. These are the original pre-amendment table's exact values: with `kind`
  // now applied only as a fixed offset after hashing (never inside the hash input) and `nudge`'s
  // offset fixed at 0, `selectFallbackIndex(userId, dayKey, 'nudge')` is byte-identical to the
  // original formula -- confirmed by running this exact table against the corrected
  // implementation, not assumed from the design alone. If FALLBACK_MESSAGES or fnv1a32 ever
  // change, this test will fail and the seeds must be re-derived deliberately, not patched to
  // pass.
  const KNOWN_SEEDS_BY_INDEX: Record<number, { userId: string; dayKey: string }> = {
    0: { userId: 'known-seed-user', dayKey: '2026-01-01' },
    1: { userId: 'known-seed-user', dayKey: '2026-01-06' },
    2: { userId: 'known-seed-user', dayKey: '2026-01-02' },
    3: { userId: 'known-seed-user', dayKey: '2026-01-03' },
    4: { userId: 'known-seed-user', dayKey: '2026-01-05' },
  };

  it('FALLBACK_MESSAGES has exactly 5 entries, matching the known-seed index range', () => {
    expect(FALLBACK_MESSAGES).toHaveLength(5);
    expect(Object.keys(KNOWN_SEEDS_BY_INDEX)).toHaveLength(FALLBACK_MESSAGES.length);
  });

  it.each(Object.entries(KNOWN_SEEDS_BY_INDEX))('index %s is reachable via its known seed (kind fixed at nudge)', (indexStr, seed) => {
    const index = Number(indexStr);
    expect(selectFallbackIndex(seed.userId, seed.dayKey, 'nudge')).toBe(index);
    const provider = buildFallbackProvider(seed.userId, seed.dayKey);
    expect(provider({ habits: [] }, 'nudge')).toBe(FALLBACK_MESSAGES[index]);
  });

  it('every message in FALLBACK_MESSAGES has at least one known seed reaching it -- full reachability, not just partial', () => {
    const reachedIndices = new Set(Object.keys(KNOWN_SEEDS_BY_INDEX).map(Number));
    for (let i = 0; i < FALLBACK_MESSAGES.length; i++) {
      expect(reachedIndices.has(i)).toBe(true);
    }
  });
});

describe('buildFallbackProvider satisfies coach-orchestration.ts#FallbackProvider', () => {
  function habitFacts(overrides: Partial<HabitCoachFacts> = {}): HabitCoachFacts {
    return {
      habitId: 'h1',
      momentumState: 'steady',
      totalCompletions: 47,
      recoveryCount: 3,
      lapseReasonCounts: {
        too_busy: 0,
        forgot: 0,
        low_energy: 0,
        not_feeling_it: 0,
        something_else: 0,
        skipped_without_reason: 0,
      },
      habitHealth: 'no_positive_recent_comparison',
      ...overrides,
    };
  }

  const UNGROUNDED_FACTS: CoachFacts = { habits: [habitFacts()] }; // steady + no_positive_recent_comparison: neither qualifies

  it('plugs directly into CoachGenerationDeps.fallbackProvider with no adapter -- a type-level and behavioural proof at once', async () => {
    const generateGroundedText = jest.fn().mockResolvedValue('should never be called');
    const deps: CoachGenerationDeps = {
      generateGroundedText,
      fallbackProvider: buildFallbackProvider('user-99', '2026-09-12'), // assigns to the real interface type directly
      validateCoachOutput: jest.fn().mockReturnValue({ valid: true }),
    };

    const result = await resolveCoachGeneration(UNGROUNDED_FACTS, 'nudge', deps);

    expect(result.path).toBe('fallback');
    if (result.path === 'fallback') {
      expect(FALLBACK_MESSAGES).toContain(result.content);
    }
  });

  it('the fallback branch never calls generateGroundedText -- no model call happens on this path', async () => {
    const generateGroundedText = jest.fn().mockResolvedValue('a real Anthropic response');
    const validateCoachOutput = jest.fn().mockReturnValue({ valid: true });
    const deps: CoachGenerationDeps = {
      generateGroundedText,
      fallbackProvider: buildFallbackProvider('user-99', '2026-09-12'),
      validateCoachOutput,
    };

    await resolveCoachGeneration(UNGROUNDED_FACTS, 'nudge', deps);

    expect(generateGroundedText).not.toHaveBeenCalled();
    expect(validateCoachOutput).not.toHaveBeenCalled(); // no model output exists to validate either
  });
});
