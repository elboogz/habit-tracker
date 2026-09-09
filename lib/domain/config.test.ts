import { CONSISTENCY_WINDOW_DAYS_BY_KIND, HABIT_HEALTH_CONFIG, MOMENTUM_CONFIG, RECOVERY_CONFIG } from './config';

// Pins the approved threshold values so a future accidental edit here is a deliberate,
// reviewed test change rather than a silent drift in behavior.
describe('RECOVERY_CONFIG', () => {
  it('matches the approved thresholds', () => {
    expect(RECOVERY_CONFIG.minResolvedLapsesForPercentage).toBe(3);
    expect(RECOVERY_CONFIG.lowRecoveryRateShameThreshold).toBe(0.3);
    expect(RECOVERY_CONFIG.rollingWindowOpportunities).toBe(10);
    expect(RECOVERY_CONFIG.minClosedLapsesForRecoveryTime).toBe(2);
  });
});

describe('MOMENTUM_CONFIG', () => {
  it('matches the approved uniform confirmation count', () => {
    expect(MOMENTUM_CONFIG.transitionConfirmationOpportunities).toBe(3);
  });

  it('matches the approved per-state candidate evidence windows', () => {
    expect(MOMENTUM_CONFIG.building.window).toBe(3);
    expect(MOMENTUM_CONFIG.steady.window).toBe(5);
    expect(MOMENTUM_CONFIG.thriving.window).toBe(8);
    expect(MOMENTUM_CONFIG.recovering.window).toBe(3);
    expect(MOMENTUM_CONFIG.rebuilding.window).toBe(5);
    expect(MOMENTUM_CONFIG.quiet.window).toBe(3);
  });
});

describe('HABIT_HEALTH_CONFIG', () => {
  it('matches the approved constants (docs/phase-5-plan.md section 4.1)', () => {
    expect(HABIT_HEALTH_CONFIG.comparisonBlockOpportunities).toBe(14);
    expect(HABIT_HEALTH_CONFIG.minOpportunitiesInSmallerBlock).toBe(10);
    expect(HABIT_HEALTH_CONFIG.minRateImprovement).toBe(0.25);
  });
});

describe('CONSISTENCY_WINDOW_DAYS_BY_KIND', () => {
  it('matches the approved per-kind Consistency windows (docs/phase-5-plan.md section 4.2), restoring the pre-Phase-5 Edge Function values', () => {
    expect(CONSISTENCY_WINDOW_DAYS_BY_KIND).toEqual({ nudge: 14, weekly: 7, monthly: 30 });
  });
});
