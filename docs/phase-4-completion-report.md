# Phase 4 Completion Report — The Recovery Flow

Implements `docs/phase-4-plan.md` (the approved plan, including the suppression revision) in full. All ten commits in the approved sequence (§9) are complete. Phase 5 has not begun — no AI coaching changes, no notification copy, no reflection-prompt rewrites, no challenge-tolerance changes.

## Commits completed

1. **`1dd192b`** — data model + migrations, no behaviour change. `LapseReasonKey`/`LapseReasonEntry`, `HabitState.lapseReasons`, `Habit.reducedTarget`, `HabitLog.reduced`, `migrateLapseReasons`, and `supabase/phase-4-recovery-flow-schema.sql`.
2. **`100e518`** — domain logic. `openLapse`, `lapseReasonSuppressionUntil` (`lib/domain/recovery.ts`), `nextScheduledOpportunityAfter` (`lib/domain/schedule.ts`), `reducedTargetFor` and reduced-aware `isDoneOnDay` (`lib/domain/habit-stats.ts`), new test fixtures, Edge Function regeneration + hand-fix (see Deviations).
3. **`c9179f2`** — sync plumbing. `lapse_reasons` row mapping, the two new habit/log columns, `mergeRemote` for `lapseReasons`, five new store actions (`addLapseReason`, `addSchedulePeriod`, `pauseHabit`, `logReducedCompletion`, `setLogAmountForDate`).
4. **`f46b3ad`** — recovery card shell. `components/recovery-card.tsx`, `lib/recovery-card-dismissals.ts`, wired into Today with Continue/Skip/Dismiss live, three stub rows.
5. **`b5bcdee`** — Do a smaller version. `habit-form.tsx` stepper, `logReducedCompletion` wiring, reduced-recovery celebration copy.
6. **`8c4b459`** — Pause this habit wiring.
7. **`c426f11`** — schedule editor in `habit-form.tsx`, "Adjust the schedule" wired to navigation.
8. **`4043758`** — Reflect flow (inline five-chip prompt + internal Skip).
9. **`1cd401e`** — retroactive entry (`HabitCalendar.onDayPress`, `DayCorrectionPanel`, `setLogAmountForDate` wiring).
10. **This commit** — documentation (this report + `CLAUDE.md` update).

## Files and schemas changed

**New files:** `components/recovery-card.tsx`, `lib/recovery-card-dismissals.ts`, `supabase/phase-4-recovery-flow-schema.sql`, `docs/phase-4-plan.md`, `docs/phase-4-completion-report.md`.

**Modified:** `lib/habit-types.ts`, `lib/domain/persistence.ts` (+ test), `lib/domain/recovery.ts` (+ test), `lib/domain/schedule.ts` (+ test), `lib/domain/habit-stats.ts` (+ test), `lib/habit-store.tsx`, `lib/supabase-sync.ts`, `lib/sync-queue.ts`, `app/(tabs)/index.tsx`, `app/habit-form.tsx`, `app/habit/[id].tsx`, `components/habit-calendar.tsx`, `supabase/functions/ai-insights/index.ts`, `supabase/functions/send-coaching-push/index.ts`, `CLAUDE.md`.

**Schema:** `lapse_reasons` table (RLS scoped to `auth.uid() = user_id`, append-only from the client) plus `habits.reduced_target` and `habit_logs.reduced` columns — all in `supabase/phase-4-recovery-flow-schema.sql`. **Confirmed applied** to the live database by the user during commit 1.

## Tests added or updated, and results

Extended `lib/domain/recovery.test.ts`, `lib/domain/schedule.test.ts`, `lib/domain/habit-stats.test.ts`, `lib/domain/persistence.test.ts` with fixtures for: `openLapse` mid-run and edge cases; a reduced completion closing a lapse identically to a full one; the §7.4 retroactive-removal worked example (a completion that had closed a lapse and fired a Recovery Event is removed, reopening the lapse and un-firing the event — proven directly, not just asserted); `nextScheduledOpportunityAfter` for daily, weekday-limited, and indefinitely-paused habits; `lapseReasonSuppressionUntil` across several `LapseReasonEntry` timings within an open lapse; `reducedTargetFor`'s derivation and clamping; `isDoneOnDay`'s reduced-awareness and backward compatibility with pre-Phase-4 logs.

**Final verification run** (after commit 9, repeated after the CLAUDE.md update in commit 10):
- `npx tsc --noEmit` — clean, no errors.
- `npx jest` — **124/124 tests passed**, 8 suites, including the pre-existing edge-function freshness check (`scripts/build-edge-functions.test.ts`), which passed because the regenerated Edge Functions were committed rather than left stale.
- `npm run lint` — clean, exit 0.

All three commands were actually run at each commit boundary, not assumed.

## Migration instructions and rollback

Already applied — included here for the record. Run in the Supabase SQL Editor:

```sql
create table if not exists public.lapse_reasons (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  missed_opportunity_date date not null,
  reason text check (reason in ('too_busy','forgot','low_energy','not_feeling_it','something_else')),
  note text,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lapse_reasons_user_id_updated_at_idx on public.lapse_reasons (user_id, updated_at);
create index if not exists lapse_reasons_habit_id_idx on public.lapse_reasons (habit_id);

alter table public.lapse_reasons enable row level security;
create policy "Individuals can manage their own lapse reasons" on public.lapse_reasons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.habits add column if not exists reduced_target int;
alter table public.habit_logs add column if not exists reduced boolean not null default false;
```

**Rollback** (safe at any time — no other table depends on `lapse_reasons`, and the two columns fall back to the pre-Phase-4 default every consumer already treats as baseline):

```sql
drop table if exists public.lapse_reasons;
alter table public.habits drop column if exists reduced_target;
alter table public.habit_logs drop column if exists reduced;
```

## Edge Functions

`supabase/functions/ai-insights/index.ts` and `supabase/functions/send-coaching-push/index.ts` were regenerated (`npm run build:edge-functions`) at commit 2, because the reduced-aware `isDoneOnDay` is in the generated whitelist. **Already re-pasted and deployed** to the Supabase Dashboard by the user, confirmed during commit 2 — not a deferred action.

## Deviations from the approved plan

1. **Edge Function hand-fix beyond the generated block (commit 2).** The plan's edge-function regen step anticipated only the generated block changing. While verifying the regen, I found both Edge Functions also hand-maintain their own `LogRow`/`HabitLog` row-mapping types and explicit `.select()` column lists *outside* the generated markers. Without updating those, the new `reduced` field would never reach the regenerated `isDoneOnDay` server-side, silently defeating the point of the commit. I hand-fixed both (`LogRow.reduced`, `HabitLog.reduced`, and added `reduced` to both `.select()` calls). This is a correctness necessity for what commit 2 already required, not new scope, but it's a real deviation from "only the generated block changes" and is reported here per instruction.
2. **§7.1/§7.2 resolved textual ambiguity (commit 9).** §7.1's pressable-range formula (`date >= addDays(dayKey(), -6)`) literally includes today, but §7.2 explicitly reasons that today should be excluded from the retroactive panel ("today already has a first-class, always-visible editor and duplicating it here would be redundant"). I implemented the more explicitly-reasoned interpretation: the 6 days *before* today are pressable, today is not. This is a resolution of an internal inconsistency in the approved text, not a scope change — flagged here rather than silently picked.
3. **On-device/browser interaction verification.** Per an explicit question to the user after commit 4 (the app requires signing in against the real Supabase project, and I had no test credentials), the user chose "code + automated checks only" for commits 4–9. Every UI-touching commit's completion is therefore backed by TypeScript, automated tests, and code-path inspection, **not** a manual on-device pass — see "Verification methods" below for the one partial exception. A full on-device acceptance pass is still recommended before considering Phase 4 user-facing-ready; see "Remaining risks."

No other deviations. The commit order, all six approved product decisions (§8.1–§8.6), and the six-option list match the plan as written.

## Verification methods, per completion requirement

- **Recovery card appears only when `openLapse !== null` AND today `isScheduledOpportunity` AND not suppressed** — code-path inspection of `eligibleHabits` in `app/(tabs)/index.tsx`, matching §3.1's formula exactly. Not manually verified on-device.
- **All four card actions suppress until the next Scheduled Opportunity** — code-path inspection (`recoveryCardSuppressedUntil`, `handleRecoveryContinue`/`handleRecoverySkip`/`handleReflectChoice`/`handleReflectSkip`, all keyed through `nextScheduledOpportunityAfter` or `lapseReasonSuppressionUntil`). Not manually verified on-device.
- **Skip writes `skipped: true`; Reflect writes the selected reason** — code-path inspection + TypeScript validation of the `addLapseReason` call sites. Not manually verified on-device.
- **Continue and Dismiss record no behavioural fact** — code-path inspection; both call only the local `dismiss()` setter from `useRecoveryCardDismissals`, never `addLapseReason`.
- **Reduced completions available only for habits with measurable targets** — automated test (`reducedTargetFor` suite in `habit-stats.test.ts`) + code-path inspection of the `reducedTargetFor(habit) !== null` render guard in `recovery-card.tsx`.
- **Schedule editor creates new effective-dated periods without editing past periods** — code-path inspection (`addSchedulePeriod` always appends a new period via the reducer, never mutates an existing one) backed by the pre-existing Phase 2 append-only design and its test coverage in `schedule.test.ts`.
- **Retroactive entries limited to the last 7 days, correct recomputation** — code-path inspection of `editableFrom` in `habit-calendar.tsx` + automated test ("example G" in `recovery.test.ts`, which proves recomputation directly rather than asserting it).
- **Retroactive removal reopens a lapse and reverses a Recovery Event** — automated test, same "example G" fixture, asserting the before/after state of `recoverableLapseInstances`, `closedLapses`, and `recoveryEvents` explicitly.
- **No shame-framed messaging, absence day-counts, or warning-coloured elements** — manual copy review of every new user-facing string across `recovery-card.tsx`, `habit-form.tsx`, `habit/[id].tsx`, `index.tsx` (grepped for miss/fail/broke/streak/shame/behind/late/overdue framing — none found beyond the pre-existing, unmodified "streak" label); manual review of styling confirms no red/orange/warning colors were introduced, only the app's existing `tint`/`icon`/`background`/`text` theme colors.
- **Full test suite / TypeScript checks** — actually run at every commit boundary; see "Tests" above for the final results.
- **Web build sanity check (commit 4 only)** — after wiring `RecoveryCard` into Today, started `npx expo start --web` and drove it with headless Playwright: the app bundles and reaches the sign-in screen with zero console errors and zero page errors. This proves the new component and its imports compile and don't crash the bundle; it does **not** exercise the card's actual interactions (that requires a signed-in session against the real Supabase project, which I don't have credentials for).

## Remaining risks / deferred decisions

- **On-device acceptance pass.** Per the user's explicit choice, no interactive on-device/browser verification was performed for the recovery card, schedule editor, Reflect prompt, or retroactive-entry panel. All are backed by TypeScript + automated domain tests + careful code-path inspection, but a real device or authenticated-browser pass is the recommended next step before treating Phase 4 as user-facing-complete.
- **Cross-device / reinstall gap for Continue/Dismiss** — explicitly accepted in §8.6; bounded to at most one extra card appearance, one Scheduled Opportunity's worth of exposure.
- **`lib/recovery-card-dismissals.ts` storage is not scoped per-user**, unlike the main `habit-tracker/state-v1:<userId>` key. On a device shared across multiple signed-in accounts, a stale dismissal entry from one account is technically readable (though not writable in a way that matters) by another. Practically harmless — habit IDs are globally-unique UUIDs, so cross-account key collision is not a realistic concern — but it's an inconsistency with the rest of the app's per-user storage convention worth knowing about. Not fixed: the plan doesn't call for per-user scoping here, and §8.6 already frames this store's entries as harmless and orphan-tolerant by design.
- **Final copy** for the recovery card, reduced-completion celebration, and lapse-reason prompt is illustrative, per §12 — written on-brand with the existing app's tone (the codebase's own em-dash-forward style, no shame framing), not final-polished copy.
- **Phase 5 has not begun.** `lapse_reasons` is written but read by nothing yet, exactly as designed — it exists to feed Phase 5's coach.

## Confirmation

Working tree is clean as of this commit (verified before pushing). All Phase 4 commits are pushed to `origin/main`. An annotated tag `phase-4-complete` is created at this documentation commit and pushed to the remote.
