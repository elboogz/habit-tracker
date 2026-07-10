/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Phase 2 only adds pure-function domain tests (no component rendering yet), but jest-expo
  // is adopted now rather than a bare Jest config so Phase 3+ component tests don't need a
  // second test-framework migration later.
  testPathIgnorePatterns: ['/node_modules/', '/scratchpad/'],
};
