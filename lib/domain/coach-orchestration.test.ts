import type { CoachFacts, HabitCoachFacts } from './coach-facts';
import type { ValidationResult } from './coach-validation';
import { COACH_CONTENT_FRESHNESS_HOURS_BY_KIND, FAILURE_SENTINEL_TTL_HOURS } from './config';
import {
  applyRejectionConsequences,
  buildFailureSentinelRow,
  buildRejectionDiagnostic,
  isWithinFailureBackoff,
  resolveCoachGeneration,
  shouldCronAttemptToday,
  type CoachGenerationDeps,
} from './coach-orchestration';

// Phase 5, Step 5 Part 1 (docs/phase-5-plan.md sections 6.5-6.6). These tests prove the orchestration
// machinery on its own terms -- they do not exercise, and must not be read as validating, the
// current pre-Step-5 prompt shape, which the validator was never designed to check. Fixtures
// mirror lib/domain/coach-validation.test.ts's own habitFacts/facts helpers.

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

function facts(...habits: HabitCoachFacts[]): CoachFacts {
  return { habits };
}

const GROUNDED_FACTS = facts(habitFacts({ momentumState: 'thriving' })); // 'thriving' qualifies -- hasGroundedInsight is true
const UNGROUNDED_FACTS = facts(habitFacts({ momentumState: 'steady', habitHealth: 'no_positive_recent_comparison' })); // neither qualifies

function makeDeps(overrides: Partial<CoachGenerationDeps> = {}): CoachGenerationDeps {
  return {
    generateGroundedText: jest.fn().mockResolvedValue('generated text'),
    fallbackProvider: jest.fn().mockReturnValue('fallback text'),
    validateCoachOutput: jest.fn().mockReturnValue({ valid: true }),
    ...overrides,
  };
}

describe('resolveCoachGeneration -- structural precedence', () => {
  it('chooses the grounded path when hasGroundedInsight(facts) === true', async () => {
    const deps = makeDeps();
    const result = await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(result.path).toBe('grounded');
    expect(deps.fallbackProvider).not.toHaveBeenCalled();
  });

  it('chooses the fallback provider when hasGroundedInsight(facts) === false, without ever attempting generation', async () => {
    const deps = makeDeps();
    const result = await resolveCoachGeneration(UNGROUNDED_FACTS, 'nudge', deps);
    expect(result).toEqual({ path: 'fallback', content: 'fallback text' });
    expect(deps.generateGroundedText).not.toHaveBeenCalled();
    expect(deps.validateCoachOutput).not.toHaveBeenCalled();
  });

  it('calls generateGroundedText and validateCoachOutput exactly once on the grounded path', async () => {
    const deps = makeDeps();
    await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(deps.generateGroundedText).toHaveBeenCalledTimes(1);
    expect(deps.validateCoachOutput).toHaveBeenCalledTimes(1);
  });

  it('passes the exact same facts object reference to validateCoachOutput -- object identity, not equality', async () => {
    let capturedFacts: CoachFacts | undefined;
    const deps = makeDeps({
      validateCoachOutput: jest.fn((_text: string, factsArg: CoachFacts) => {
        capturedFacts = factsArg;
        return { valid: true };
      }),
    });
    await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(capturedFacts).toBe(GROUNDED_FACTS); // Object.is identity, not a deep-equality check
  });

  it('on validator pass, returns the grounded content for the normal sanitize/cache/return-or-send path to continue with', async () => {
    const deps = makeDeps({
      generateGroundedText: jest.fn().mockResolvedValue('a grounded message'),
      validateCoachOutput: jest.fn().mockReturnValue({ valid: true }),
    });
    const result = await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(result).toEqual({ path: 'grounded', content: 'a grounded message' });
  });

  it('on validator rejection, discards the generated prose -- the result carries no text field at all', async () => {
    const rejection: ValidationResult = { valid: false, invalidNumerals: ['57%'] };
    const deps = makeDeps({
      generateGroundedText: jest.fn().mockResolvedValue('a message citing an ungrounded 57%'),
      validateCoachOutput: jest.fn().mockReturnValue(rejection),
    });
    const result = await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(result).toEqual({ path: 'rejected', validation: rejection });
    // Structural, not just behavioural: no key on the result could ever hold the rejected prose.
    expect(Object.keys(result)).not.toContain('content');
    expect(JSON.stringify(result)).not.toContain('a message citing an ungrounded 57%');
  });

  it('on validator rejection, never calls the fallback provider -- rejection is not "no grounded insight available"', async () => {
    const deps = makeDeps({
      validateCoachOutput: jest.fn().mockReturnValue({ valid: false, invalidNumerals: ['12'] }),
    });
    await resolveCoachGeneration(GROUNDED_FACTS, 'nudge', deps);
    expect(deps.fallbackProvider).not.toHaveBeenCalled();
  });
});

describe('applyRejectionConsequences', () => {
  it('always persists the failure sentinel', async () => {
    const persistFailureSentinel = jest.fn().mockResolvedValue(undefined);
    await applyRejectionConsequences({ persistFailureSentinel });
    expect(persistFailureSentinel).toHaveBeenCalledTimes(1);
  });

  it('marks the cron push attempt handled for today when that dependency is supplied (the push/cron caller)', async () => {
    const persistFailureSentinel = jest.fn().mockResolvedValue(undefined);
    const markCronPushHandledToday = jest.fn().mockResolvedValue(undefined);
    await applyRejectionConsequences({ persistFailureSentinel, markCronPushHandledToday });
    expect(markCronPushHandledToday).toHaveBeenCalledTimes(1);
  });

  it('does not require or call a cron-marking step for the interactive caller, which supplies none', async () => {
    const persistFailureSentinel = jest.fn().mockResolvedValue(undefined);
    await expect(applyRejectionConsequences({ persistFailureSentinel })).resolves.toBeUndefined();
  });
});

describe('shouldCronAttemptToday -- same-day cron suppression', () => {
  it('does not attempt again once today has already been marked handled', () => {
    // Simulates: a rejection occurred earlier today and applyRejectionConsequences stamped it.
    expect(shouldCronAttemptToday('2026-09-12', '2026-09-12')).toBe(false);
  });

  it('attempts on a day that has not yet been marked handled', () => {
    expect(shouldCronAttemptToday('2026-09-11', '2026-09-12')).toBe(true);
    expect(shouldCronAttemptToday(null, '2026-09-12')).toBe(true);
  });
});

describe('isWithinFailureBackoff', () => {
  it('is still backing off immediately after the sentinel was written', () => {
    const now = '2026-09-12T10:00:00.000Z';
    expect(isWithinFailureBackoff(now, 'nudge', now)).toBe(true);
  });

  it('is no longer backing off once the kind-specific TTL has elapsed', () => {
    const sentinelCreatedAt = '2026-09-12T10:00:00.000Z';
    const ttlHours = FAILURE_SENTINEL_TTL_HOURS.nudge;
    const justAfterTtl = new Date(new Date(sentinelCreatedAt).getTime() + (ttlHours * 60 * 60 * 1000) + 1000).toISOString();
    expect(isWithinFailureBackoff(sentinelCreatedAt, 'nudge', justAfterTtl)).toBe(false);
  });
});

describe('FAILURE_SENTINEL_TTL_HOURS -- every failure TTL is shorter than its content freshness horizon', () => {
  it.each(['nudge', 'weekly', 'monthly'] as const)('%s', (kind) => {
    expect(FAILURE_SENTINEL_TTL_HOURS[kind]).toBeLessThan(COACH_CONTENT_FRESHNESS_HOURS_BY_KIND[kind]);
  });
});

describe('buildFailureSentinelRow -- the sentinel counts toward the existing rate limit', () => {
  it('produces an ordinary ai_insights row, distinguished from a successful one only by content', () => {
    const row = buildFailureSentinelRow('nudge', 'user-1', 'claude-sonnet-4-6', '2026-09-12T10:00:00.000Z');
    expect(row).toEqual({
      user_id: 'user-1',
      kind: 'nudge',
      period_start: null,
      period_end: null,
      content: '',
      model: 'claude-sonnet-4-6',
      created_at: '2026-09-12T10:00:00.000Z',
    });
  });

  it('carries a created_at the existing rate-limit count query keys on, and no field that query would need to special-case', () => {
    // The real rate-limit query is select('id', { count: 'exact', head: true }).gt('created_at',
    // rl24hStart) -- it filters on created_at only, nothing else. A sentinel row therefore
    // requires no change to that query and no separate counting mechanism.
    const row = buildFailureSentinelRow('nudge', 'user-1', 'claude-sonnet-4-6', '2026-09-12T10:00:00.000Z');
    expect(typeof row.created_at).toBe('string');
    expect(Object.keys(row)).not.toContain('is_sentinel'); // no dedicated flag column exists or is introduced
  });
});

describe('buildRejectionDiagnostic -- minimal, structurally prose-free', () => {
  it('reports kind, the validator reason, and the enumerable allowed set -- never the generated text', () => {
    const f = facts(habitFacts({ recoveryRatePct: 82, totalCompletions: 47 }));
    const rejection: ValidationResult = { valid: false, invalidNumerals: ['57%'] };
    const diagnostic = buildRejectionDiagnostic('nudge', f, rejection as Extract<ValidationResult, { valid: false }>);
    expect(diagnostic.kind).toBe('nudge');
    expect(diagnostic.invalidNumerals).toEqual(['57%']);
    expect(diagnostic.allowedPct).toEqual([82]);
    expect(diagnostic.allowedPlain).toContain(47);
  });

  it('has no parameter through which the generated prose could be supplied', () => {
    // Structural: buildRejectionDiagnostic's signature is (kind, facts, validation) -- three
    // parameters, none of which is or could be the generated text. Confirmed by arity, not by
    // convention.
    expect(buildRejectionDiagnostic.length).toBe(3);
  });
});
