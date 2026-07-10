import { MOMENTUM_CONFIG, RECOVERY_CONFIG } from './config';

// Pins the approved threshold values so a future accidental edit here is a deliberate,
// reviewed test change rather than a silent drift in behavior.
describe('RECOVERY_CONFIG', () => {
  it('matches the approved thresholds', () => {
    expect(RECOVERY_CONFIG.minResolvedLapsesForPercentage).toBe(3);
    expect(RECOVERY_CONFIG.lowRecoveryRateShameThreshold).toBe(0.3);
    expect(RECOVERY_CONFIG.rollingWindowOpportunities).toBe(10);
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
