// Placeholder proving the Jest + jest-expo harness runs before any domain code exists.
// Superseded in spirit by the real domain-layer test suites added in later Phase 2 commits,
// but left in place as a minimal smoke test for the test harness itself.
describe('test harness', () => {
  it('runs TypeScript test files under jest-expo', () => {
    expect(1 + 1).toBe(2);
  });
});
