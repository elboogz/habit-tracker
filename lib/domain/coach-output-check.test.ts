import type { CoachFacts, HabitCoachFacts } from './coach-facts';
import { combinedValidate } from './coach-output-check';
import { buildRejectionDiagnostic } from './coach-orchestration';

// Phase 5, Step 5 Part 3b, D1 fix. Pins that a numeric failure and a lexical failure remain
// distinguishable through combinedValidate and the resulting buildRejectionDiagnostic output --
// the defect this replaces was invalidNumerals silently holding rejected phrases like "getting
// back on track" instead of actual numerals.

function habitFacts(overrides: Partial<HabitCoachFacts> = {}): HabitCoachFacts {
  return {
    habitId: 'h1',
    momentumState: 'building',
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
    recoveryRatePct: 82,
    ...overrides,
  };
}

function facts(...habits: HabitCoachFacts[]): CoachFacts {
  return { habits };
}

describe('combinedValidate -- clean text passes', () => {
  it('passes text with no invalid numerals and no prohibited phrases', () => {
    const f = facts(habitFacts());
    const result = combinedValidate('You have completed this habit consistently, at 82%.', f);
    expect(result).toEqual({ valid: true });
  });
});

describe('combinedValidate -- numeric failure stays a numeric failure', () => {
  it('reports the invented numeral in invalidNumerals, and matchedPhrases is absent', () => {
    const f = facts(habitFacts());
    const result = combinedValidate('You completed this 58 times out of every 100 opportunities.', f);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.invalidNumerals).toContain('58');
      expect(result.invalidNumerals).toContain('100');
      expect(result.matchedPhrases).toBeUndefined();
    }
  });

  it('buildRejectionDiagnostic reports the real invalid numerals for a numeric failure', () => {
    const f = facts(habitFacts());
    const result = combinedValidate('You completed this 58 times out of every 100 opportunities.', f);
    if (result.valid) throw new Error('expected a rejection');
    const diagnostic = buildRejectionDiagnostic('nudge', f, result);
    expect(diagnostic.invalidNumerals).toEqual(expect.arrayContaining(['58', '100']));
  });
});

describe('combinedValidate -- lexical failure stays a lexical failure', () => {
  it('reports the matched phrase in matchedPhrases, and invalidNumerals stays honestly empty', () => {
    const f = facts(habitFacts());
    const result = combinedValidate('Keep your streak going, and try getting back on track this week.', f);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.invalidNumerals).toEqual([]); // no invented numeral here -- must not be conflated with a phrase
      expect(result.matchedPhrases).toEqual(expect.arrayContaining(['streak', 'getting back on track']));
    }
  });

  it('buildRejectionDiagnostic reports invalidNumerals as empty for a purely lexical failure -- never the phrase text', () => {
    const f = facts(habitFacts());
    const result = combinedValidate('Keep your streak going strong!', f);
    if (result.valid) throw new Error('expected a rejection');
    const diagnostic = buildRejectionDiagnostic('nudge', f, result);
    expect(diagnostic.invalidNumerals).toEqual([]);
    expect(diagnostic.invalidNumerals).not.toContain('streak'); // the exact defect this replaces
  });
});

describe('combinedValidate -- both failure classes: not structurally observable by design', () => {
  it('numeric failure short-circuits before the lexical check ever runs, so a single result never carries both', () => {
    // This text is deliberately both: "100" is an invented numeral, and "streak" is a prohibited
    // phrase. combinedValidate checks the numeric validator first and returns immediately on
    // failure, so the lexical check is never reached -- confirmed here, not assumed.
    const f = facts(habitFacts());
    const result = combinedValidate('You are 100% on your streak.', f);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.invalidNumerals).toContain('100%');
      expect(result.matchedPhrases).toBeUndefined(); // the lexical check never ran
    }
  });
});
