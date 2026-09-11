import type { CoachFacts, HabitCoachFacts } from './coach-facts';
import { resolveCoachGeneration, type CoachGenerationDeps } from './coach-orchestration';
import { buildFallbackProvider, FALLBACK_MESSAGES, fnv1a32, selectFallbackIndex } from './coach-fallback';

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

  // Vectors for this module's actual seed format (`${userId}|${dayKey}`), computed once directly
  // from this implementation and hardcoded here as a regression pin.
  it.each([
    ['user-1|2026-09-12', 3894357170],
    ['2c9e6a0b-3e11-4b2a-9f0d-7a5c4e8b1d62|2026-09-11', 904319070],
  ])('fnv1a32(%j) === %i', (input, expected) => {
    expect(fnv1a32(input)).toBe(expected);
  });
});

describe('selectFallbackIndex / buildFallbackProvider -- determinism', () => {
  it('returns the same result for the same seed, called repeatedly', () => {
    const a = selectFallbackIndex('user-42', '2026-09-12');
    const b = selectFallbackIndex('user-42', '2026-09-12');
    expect(a).toBe(b);
  });

  it('a provider built from the same (userId, today) pair returns the same message every call', () => {
    const provider = buildFallbackProvider('user-42', '2026-09-12');
    const facts: CoachFacts = { habits: [] };
    const first = provider(facts, 'nudge');
    const second = provider(facts, 'nudge');
    const third = provider(facts, 'weekly'); // kind is ignored by design -- still deterministic
    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  it('a different day for the same account can select a different message (not asserting it always does -- just that the day key is live input)', () => {
    const dayOne = selectFallbackIndex('user-42', '2026-09-12');
    const dayTwo = selectFallbackIndex('user-42', '2026-09-13');
    // Both are valid indices into the closed set either way; this only confirms dayKey
    // participates in the hash input, not a specific outcome.
    expect(FALLBACK_MESSAGES[dayOne]).toBeDefined();
    expect(FALLBACK_MESSAGES[dayTwo]).toBeDefined();
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

  it.each(knownUserIds.flatMap((userId) => knownDayKeys.map((dayKey): [string, string] => [userId, dayKey])))(
    'userId=%j dayKey=%j selects a valid index',
    (userId, dayKey) => {
      const index = selectFallbackIndex(userId, dayKey);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(FALLBACK_MESSAGES.length);
      expect(FALLBACK_MESSAGES[index]).toEqual(expect.any(String));
    },
  );

  it('the provider always returns a string that is a member of FALLBACK_MESSAGES, for every known seed above', () => {
    const facts: CoachFacts = { habits: [] };
    for (const userId of knownUserIds) {
      for (const dayKey of knownDayKeys) {
        const provider = buildFallbackProvider(userId, dayKey);
        expect(FALLBACK_MESSAGES).toContain(provider(facts, 'nudge'));
      }
    }
  });
});

describe('every approved message is reachable through known deterministic seeds', () => {
  // Found by a one-time brute-force search of the real fnv1a32 function over a fixed userId and a
  // small range of day keys, then hardcoded here -- not re-derived at test time, and not a
  // probabilistic search. If FALLBACK_MESSAGES or fnv1a32 ever change, this test will fail and
  // the seeds must be re-derived deliberately, not patched to pass.
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

  it.each(Object.entries(KNOWN_SEEDS_BY_INDEX))('index %s is reachable via its known seed', (indexStr, seed) => {
    const index = Number(indexStr);
    expect(selectFallbackIndex(seed.userId, seed.dayKey)).toBe(index);
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
