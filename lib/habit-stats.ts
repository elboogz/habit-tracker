// Re-export barrel: the pure functions that used to live in this file were relocated to
// lib/domain/habit-stats.ts as part of Phase 2 (see docs/phase-2-implementation-plan.md),
// which is the single home for the shared domain layer consumed by the RN app and both
// Deno Edge Functions. This file exists only so existing `@/lib/habit-stats` imports across
// screens/components keep working unchanged.
export * from './domain/habit-stats';
