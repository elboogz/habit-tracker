# Phase 2 Completion Report — Core Domain Model

Phase 2 is complete, following the approved nine-commit sequence in `docs/phase-2-implementation-plan.md` (Revision 2), as approved with the product/technical decisions in the Phase 2 approval instruction. This report covers what was built, what was tested, the migration status, deviations found during implementation, and what remains open for later phases.

---

## Commits completed

| # | Commit | Summary |
|---|---|---|
| 1 | `f20de34` | Add Jest + jest-expo test framework |
| 2 | `ded171d` | Relocate pure stats functions into `lib/domain/`; `lib/habit-stats.ts` becomes a re-export barrel |
| 3 | `2f66ce5` | Add `lib/domain/config.ts` threshold module |
| 4 | `8fe3a13` | Add `HabitSchedulePeriod` and the scheduled-opportunity resolver (`lib/domain/schedule.ts`) |
| 5 | `aa0393e` | Add `habit_schedule_periods` migration SQL; wire `schedulePeriods` into local state + sync |
| 6 | `c82eae4` | Relocate challenge-failure evaluation from the Today screen into `HabitStoreProvider` |
| 7 | `d76c5c8` | Add Recovery Event / Lapse / Recoverable Lapse Opportunity / Recovery Rate / Recovery Time (`lib/domain/recovery.ts`) |
| 8 | `17207d5` | Add Momentum / Momentum State with candidate/confirmed hysteresis (`lib/domain/momentum.ts`) |
| 9 | `84f4517` | Add the Edge Function generation script; regenerate both Edge Functions |
| — | `285b658` | Document the Phase 2 architecture changes in `CLAUDE.md` (not one of the nine plan commits; done as part of the completion requirements) |

**Migration was applied manually, out of band, between commits 5 and 6**, per the required pause:
- Migration file: `supabase/habit_schedule_periods_schema.sql`
- Applied: 2026-07-11, to the live Supabase project
- Confirmed by you: the table, indexes, and RLS policy were created successfully with no errors
- Confirmed additive: no existing table, column, or row was altered; the migration only adds the new `habit_schedule_periods` table

`docs/phase-1-audit.md` and `docs/phase-2-implementation-plan.md` remain uncommitted from earlier in this session (per those turns' instructions at the time) — flagging this so it isn't mistaken for an oversight; let me know if you'd like them committed too.

---

## Files and schemas changed

**New domain layer (`lib/domain/`)**
- `day-key.ts` — `dayKey`, `addDays`, `parseDayKeyParts`, `weekdayOf`, `localDayKeyOf`, `daysBetween`
- `habit-stats.ts` — relocated pure stats functions (now also schedule-aware in `challengeProgress`, and `streakForHabit`/`recentHistory`/`consistency` gained an optional `asOfDate` parameter)
- `persistence.ts` — `initialState`, `migrateChallenges`, `migrateSchedulePeriods`, `backfillTimestamps` (extracted from `habit-store.tsx` so they're testable without mocking AsyncStorage/Supabase)
- `schedule.ts` — `HabitSchedulePeriod` resolution (`scheduleForDate`, `isScheduledOpportunity`, `scheduledOpportunitiesUpTo`)
- `config.ts` — `RECOVERY_CONFIG`, `MOMENTUM_CONFIG`
- `recovery.ts` — `recoverableLapseInstances`, `recoveryEvents`, `isRecoveryEvent`, `closedLapses`, `averageRecoveryTime`, `recoveryRate`
- `momentum.ts` — `momentum`, `candidateStateAt`, `confirmedStateAt`, `computeConfirmedState`

**Modified**
- `lib/habit-types.ts` — added `ScheduleDays`, `HabitSchedulePeriod`, `HabitState.schedulePeriods`
- `lib/habit-stats.ts` — now a re-export barrel over `lib/domain/`
- `lib/habit-store.tsx` — hydration/migration wired to `schedulePeriods`; challenge-failure evaluation moved here from the Today screen
- `lib/supabase-sync.ts`, `lib/sync-queue.ts` — row mapping and outbox support for `habit_schedule_periods`
- `app/(tabs)/index.tsx`, `app/(tabs)/challenges.tsx`, `app/(tabs)/settings.tsx` — thread `schedulePeriods` into `challengeProgress` calls; the failure-detection `useEffect` removed from `index.tsx`
- `supabase/functions/ai-insights/index.ts`, `supabase/functions/send-coaching-push/index.ts` — hand-duplicated stats functions replaced by the generated block; row-shape adapters added (see deviations)
- `package.json` — `test`, `build:edge-functions` scripts; `jest`, `jest-expo`, `@types/jest` devDependencies
- `CLAUDE.md` — documents the above (see the dedicated commit)

**New non-code files**
- `jest.config.js`
- `scripts/build-edge-functions.js`, `scripts/build-edge-functions.test.ts`
- `supabase/habit_schedule_periods_schema.sql` (the migration)

**Schema change**: exactly one new table, `habit_schedule_periods` (id, user_id, habit_id, effective_from, days_of_week, paused, created_at, updated_at), with RLS scoped to `auth.uid() = user_id`, matching every other table in this schema. No existing table, column, or row was touched.

---

## Tests added and results

**93 tests across 8 suites, all passing** (`npm test`):

| Suite | Count | Covers |
|---|---|---|
| `__tests__/harness.test.ts` | 1 | Test harness smoke test |
| `lib/domain/config.test.ts` | 5 | Approved threshold values pinned |
| `lib/domain/habit-stats.test.ts` | 28 | Characterization of relocated functions, `asOfDate` override, schedule-aware `challengeProgress` |
| `lib/domain/schedule.test.ts` | 18 | Schedule resolution, tie-breaking, creation floor, timezone-independent `weekdayOf`, mid-history schedule change |
| `lib/domain/persistence.test.ts` | 8 | Migration behavior, including the direct backward-compatibility proof |
| `lib/domain/recovery.test.ts` | 18 | All six worked examples, sparse/threshold display rules, rolling vs. lifetime horizons |
| `lib/domain/momentum.test.ts` | 16 | Each candidate state, momentum trend, hysteresis (single-anomaly stability, delayed confirmed transition, flapping-never-confirms), long-term trajectories |
| `scripts/build-edge-functions.test.ts` | 5 | Generated-block freshness, import-safety guard, declaration extractor |

Final verification run (this session, after commit 9 and the `CLAUDE.md` update):
- `npm test`: **93/93 passed**
- `npx tsc --noEmit`: **clean, no errors**
- `npx eslint .`: **0 new errors/warnings** — the 7 remaining errors and 1 warning are pre-existing and unrelated (Deno `npm:` specifiers in both Edge Functions, `no-undef` on Node globals in `scripts/generate-chime.js`, present before Phase 2 and confirmed unchanged by re-checking against the Phase 1 baseline)

---

## Migration instructions and rollback notes

**Already applied** (see above). For reference, the exact SQL is in `supabase/habit_schedule_periods_schema.sql`:

```sql
create table if not exists public.habit_schedule_periods (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  effective_from date not null,
  days_of_week smallint[],
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists habit_schedule_periods_user_id_updated_at_idx
  on public.habit_schedule_periods (user_id, updated_at);
create index if not exists habit_schedule_periods_habit_id_idx
  on public.habit_schedule_periods (habit_id);

alter table public.habit_schedule_periods enable row level security;

create policy "Individuals can manage their own schedule periods" on public.habit_schedule_periods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Rollback** (commented in the same file, not run): `drop table if exists public.habit_schedule_periods;` — safe at any time, since nothing else depends on this table and no habit currently has any rows in it (no schedule-editing UI exists yet).

**Reversibility confirmed**: additive only. The local `schedulePeriods` field defaults to `[]` when absent (`migrateSchedulePeriods`), which resolves to daily/unpaused — identical to pre-Phase-2 behavior for every existing habit. No historical `habits`, `habit_logs`, or `challenges` row was deleted, altered, or reinterpreted by any Phase 2 commit.

---

## Re-pasting the regenerated Edge Functions

**Not required immediately — can safely wait until Phase 5.** The regenerated `supabase/functions/ai-insights/index.ts` and `supabase/functions/send-coaching-push/index.ts` are **behaviorally identical** to what's currently deployed: the only change is that five previously hand-duplicated functions (`dayKey`, `addDays`, `isDoneOnDay`, `streakForHabit`, `consistency`) now come from a generated block sourced from `lib/domain/`, with a thin adapter (`toDomainHabit`/`toDomainLogs`) bridging the snake_case Supabase row shape to the camelCase domain shape the shared functions expect. Streak/consistency outputs are unchanged. Since Phase 5 is the AI coach rewrite and will need to touch these functions anyway for genuinely new logic, re-pasting now would just be an extra round-trip with no user-visible benefit today.

If you do want to pick up the regenerated versions sooner (e.g. to start benefiting from the shared-source guarantee immediately): open each file in this repo, copy its full contents, and paste over the corresponding function in Supabase Dashboard → Edge Functions. No new secrets or config changes are needed.

---

## Deviations from the approved plan

All of the following were discovered while implementing, not anticipated in the written plan. None contradict the approved product specification or approved decisions — each is a technical correction or refinement, reported per the implementation instructions.

1. **Circular import (commit 6).** Threading `schedulePeriods` into `challengeProgress` required `isScheduledOpportunity` from `schedule.ts`, but `schedule.ts` already imported day-key helpers from `habit-stats.ts` — importing back would have been circular. Fixed by extracting the dependency-free day-key utilities into a new `lib/domain/day-key.ts` that both modules import from instead of each other.

2. **Worked example C arithmetic (commit 7).** The plan's "several misses with no return" example treated the pairwise instance resolving *on* today as "open, not yet resolved" — this directly contradicted examples A and B, which both resolve a pair whose resolving date is today (a same-day completion immediately closes the pair and fires the Recovery Event — the entire premise of the recovery celebration). Implemented the consistent rule instead: a pair resolves on its current data regardless of whether the resolving date is today. Example C's fixture uses the corrected count (8 resolved instances, not 7), documented in full in `lib/domain/recovery.test.ts`'s header.

3. **`missedOpportunityCount` added to `ClosedLapse` (commit 8).** Momentum State's `recovering`/`rebuilding` distinction needed lapse length in Scheduled-Opportunity terms, not calendar days (`recoveryTimeDays`, which only coincide today because every habit is still daily). Added as a new field to the existing `ClosedLapse` type from commit 7, with existing tests updated.

4. **Confirmed-state implementation refactored for testability (commit 8).** Rather than one monolithic scan, the generic hysteresis mechanism (`computeConfirmedState`) was factored out from the momentum-specific candidate logic, so "flapping never confirms" could be proven against a synthetic sequence directly, independent of any real habit-history pattern.

5. **A specific finding about `recovering`'s hysteresis (commit 8, not a code change, a recorded observation).** `MOMENTUM_CONFIG.recovering.window` and `transitionConfirmationOpportunities` are both 3, so any qualifying short recovery always confirms exactly 3 opportunities after it occurs, with no delay beyond that. This is consistent with the product intent that a recovery should register clearly, unlike the decline-direction states where hysteresis is what actually matters (verified separately).

6. **Row-shape mismatch between Edge Functions and `lib/domain/` (commit 9).** The Edge Functions query raw Supabase rows (snake_case: `habit_id`, `target_count`), while `lib/domain/` operates on camelCase `Habit`/`HabitLog` objects. Naively inlining the domain functions verbatim would have silently broken on the field-name mismatch. Fixed with a small, hand-written (not generated) adapter in each Edge Function, mirroring what `lib/supabase-sync.ts` already does client-side for the same reason.

7. **Per-recipient timezone requirement (commit 9).** `send-coaching-push` computes each recipient's own local "today" and threads it explicitly through `streakForHabit`/`consistency`; the domain versions of those functions only supported the client's implicit "always now". Extended `streakForHabit`/`recentHistory`/`consistency` with an optional `asOfDate` parameter (defaulting to live "now", so every existing call site is unaffected) rather than leaving this Edge Function on a separate, unshared implementation for the two functions that most need cross-timezone correctness.

8. **Generator whitelist narrowed (commit 9).** An early version of the generator inlined whole source files, which pulled in `challengeProgress`/`allDoneOnDay` — referencing `Challenge`/`HabitSchedulePeriod`/`isScheduledOpportunity`, none of which exist in either Edge Function. Narrowed to an explicit whitelist of exactly the declarations each Edge Function actually needs.

---

## Remaining risks and decisions deferred to later phases

- **Presentation of Recovery Rate** (lifetime vs. rolling vs. both) is computed but not displayed anywhere yet — left open for Phase 3, per the approved decision.
- **Momentum State user-facing labels** are still internal keys (`insufficient_data`, `building`, etc.) — wording is a Phase 3 decision per the approved plan.
- **The Momentum threshold table and confirmation count are first proposals**, not empirically validated against real usage — expect tuning once Phase 3+ makes them visible.
- **Challenge tolerance redesign** (a single missed day currently still fails a challenge outright) is unchanged by design — Phase 7's job, not Phase 2's.
- **Lapse Reason** has no table yet (only the concept is implied by the domain layer's scope) — deferred to Phase 4, which is where its writer UI ships.
- **Momentum State history** (for analytics trend charts) has no storage — deferred to Phase 8.
- **CLI-deployed Edge Functions** (a genuinely shared live import, vs. the generated-inlining approach used here) remains an open workflow decision, not adopted.
- **`README.md`** was not updated — it already predates Supabase/auth (a pre-existing gap, not introduced or worsened by Phase 2) and Phase 2 has no user-facing or setup changes to document there.
- **Re-pasting the regenerated Edge Functions** into the Supabase Dashboard is optional right now (see above) and can be bundled into Phase 5 instead.

---

## Confirmation

- Existing habits continue to behave as everyday, unpaused habits with no forced user setup — confirmed via the schedule resolver's zero-periods default and the `challengeProgress` schedule-awareness test proving identical output today.
- No historical completion data has been deleted or reinterpreted — no `habits`, `habit_logs`, or `challenges` row was touched by any commit or by the migration.
- **Phase 3 has not begun.** No user-facing progress, coaching, reflection, challenge, notification, or design change was made beyond what Phase 2 required (the mechanical `challengeProgress` threading and the Edge Function adapters, both explicitly scoped to preserve existing behavior).

Waiting for approval before beginning Phase 3.
