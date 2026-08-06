# Phase 4 Plan — The Recovery Flow

Planning document only. No source code, schema, prompt, or configuration file has been changed to produce this document. Phase 4 implementation has not begun.

This plan builds on the completed domain layer (`lib/domain/`, Phase 2) and the completed experience layer (Phase 3 — Behaviour Snapshot, recovery celebration, streak demotion). It designs the interaction Phase 3 deliberately deferred: what a user is offered, not just shown, when they return after a missed Scheduled Opportunity.

**Amendments applied (post-approval revision).** This version incorporates three approved amendments to the plan as originally submitted: (1) "count-type habits" is replaced with the spec's own phrase "habits with measurable targets" everywhere the implementation doesn't force the narrower wording (§2.3, §5, §8.1); (2) "Continue today" and "Skip for today" are no longer behaviourally identical (§3.4, §3.5, §4.1, §8.2); (3) "Skip for today" now suppresses the recovery card only until the habit's next Scheduled Opportunity, not for the remainder of the open lapse, backed by a new domain primitive (§2.4, §3.4).

**Suppression revision (this update).** The prior revision gave "Continue today" and Reflect whole-lapse suppression while giving "Skip for today" the shorter next-opportunity suppression — an inconsistency. This update makes the suppression **duration** identical across all four card actions (Continue today, Skip for today, dismiss, Reflect): every one of them now suppresses the card only until the habit's next Scheduled Opportunity, never for the remainder of an open lapse. It also replaces device-local-only suppression for Skip and Reflect with derivation from the synced `LapseReasonEntry` fact those two actions already write, so their suppression is consistent across devices and survives a reinstall. See §3.4 for the full mechanics and §8.6 for why Continue/dismiss (which record no fact) remain the one case still using local-only storage. A full change log is at the end of this document.

---

## 1. Relationship to Phase 3's morning-after design

This needs to be addressed directly, because on its surface Phase 4 appears to contradict a Phase 3 decision.

`docs/phase-3-experience-plan.md` §6.1 designed the single-miss case to produce **zero interruption** on Today: "Today shows no banner, no colour change, no interruption." That was correct for Phase 3, whose scope was passive, honest metrics — there was no interactive flow yet for a banner to lead into, so any banner would have been a dead end (a guilt notice with nowhere to go).

Phase 4's mandate, directly from the locked spec's Phase 4 section, is to build exactly that interactive flow. The recovery card introduced here **supersedes** Phase 3 §6.1's "no banner" rule for the specific case where a habit has an open (unresolved) lapse — this is an intentional, spec-mandated evolution, not a regression or an unreviewed scope change. Two things are preserved unchanged from Phase 3:

- The card is never a blocking modal and never appears for a single same-day non-event (today's own unchecked box still looks exactly like it always has — see §3 below for the precise trigger condition).
- Every other Phase 3 surface (Behaviour Snapshot, Momentum State badge/narrative, recovery celebration, metric hierarchy, streak placement) is untouched by this plan.

---

## 2. Domain layer: what's missing and what's added

Per the Global Implementation Constraints, every behavioural fact must come from `lib/domain/`. Four genuine gaps exist; everything else Phase 4 needs already exists.

### 2.1 Gap 1 — no way to ask "does this habit currently have an unresolved miss?"

`lib/domain/recovery.ts` has `closedLapses` (lapses that have already ended in a completion) but nothing for the trailing, still-open run. This is the single new domain primitive Phase 4 actually needs.

**New function**, added to `lib/domain/recovery.ts`, mirroring `closedLapses`' run-tracking but for the tail:

```ts
export type OpenLapse = {
  habitId: string;
  firstMissedDate: string;
  missedOpportunityCount: number;
};

/**
 * The still-unresolved trailing run of missed Scheduled Opportunities, if any, evaluated as of
 * the day before `today` -- today's own opportunity is never itself judged as missed (consistent
 * with every other function in this module), so an open lapse can only be detected from
 * yesterday's opportunity backward. Returns null if the habit's most recent opportunity before
 * today was completed, or if it has no opportunities before today at all.
 */
export function openLapse(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  logs: HabitLog[],
  today: string,
): OpenLapse | null
```

This is a same-shape sibling of `closedLapses`, not a redesign of it — `closedLapses` still stops at the last *closed* run; `openLapse` only looks at the tail run that hasn't closed. No existing function changes.

### 2.2 Gap 2 — a reduced completion must count as "done" for the day

This is the more consequential change, so it's called out on its own. For a reduced completion to genuinely "maintain momentum" (never count as a fresh miss), the day it's logged on must read as completed to every downstream consumer — Consistency, Momentum State, Recovery Rate, `challengeProgress` — none of which should be reimplemented to special-case reduced completions individually.

**Modify** `isDoneOnDay` in `lib/domain/habit-stats.ts`:

```ts
export function isDoneOnDay(habit: Habit, logs: HabitLog[], date: string): boolean {
  const dayLogs = logsForHabitOnDay(logs, habit.id, date);
  if (dayLogs.some((log) => log.reduced)) return true;
  const total = dayLogs.reduce((sum, log) => sum + log.count, 0);
  return habit.type === 'count' ? total >= (habit.targetCount ?? 1) : total > 0;
}
```

This is additive and backward-compatible: no existing `HabitLog` has a `reduced` field, so every existing computation over existing data is byte-for-byte unchanged. Every function built on `isDoneOnDay` (streaks, consistency, recovery, momentum, challenge progress) automatically treats a reduced day as a completed one with no further changes — this is the intended, and only, mechanism by which "a smaller version still counts."

**Consequence to state explicitly, not bury**: a reduced completion counts *fully* toward Momentum State and Consistency, identically to a full completion. This is a deliberate reading of "maintaining momentum, never falling short" — a reduced day is not partial credit, it's a full day. Flagging this now because it's the one place a reviewer might expect proportional credit instead.

**Required side effect**: `isDoneOnDay` is one of the functions `scripts/build-edge-functions.js` inlines into both Edge Functions (see `SOURCES` in that file). This change requires running `npm run build:edge-functions` and re-pasting `ai-insights` and `send-coaching-push` into the Supabase Dashboard as part of the commit that makes this change — called out explicitly in the commit sequence (§9).

### 2.3 New pure helper — the reduced target itself

Added to `lib/domain/habit-stats.ts` (same file `totalCompletions` was added to in Phase 3 — one small function doesn't need its own module):

```ts
/**
 * The target to use for a "smaller version" of this habit, or null if none should be offered.
 * Only ever non-null for habits with a measurable target, per the product decision in
 * docs/phase-4-plan.md section 8.1 -- a habit with no measurable target has no natural notion of
 * "smaller." Today the data model has exactly one kind of measurable target (a count habit's
 * targetCount), so this check and "habits with measurable targets" describe the same set; if a
 * future habit type introduces another kind of numeric target, this is the one place that would
 * need to broaden.
 */
export function reducedTargetFor(habit: Habit): number | null {
  if (habit.type !== 'count' || !habit.targetCount) return null;
  if (habit.reducedTarget) return habit.reducedTarget;
  return Math.max(1, Math.round(habit.targetCount / 3));
}
```

The `/3` default reproduces the master spec's own worked examples almost exactly (30 min → 10 min; 8 glasses → "focus on the next glass," i.e. effectively 1–3) without inventing a new ratio.

### 2.4 Gap 3 — finding a habit's next Scheduled Opportunity

Needed for the unified suppression rule in §3.4: whichever of the four card actions is taken, the recovery card should stay quiet only until the habit's *next* Scheduled Opportunity, never for the rest of the current lapse. `lib/domain/schedule.ts` today only looks backward (`scheduledOpportunitiesUpTo`) — nothing looks forward from a date to find the next one.

**New function**, added to `lib/domain/schedule.ts` alongside `isScheduledOpportunity`:

```ts
/**
 * The next date strictly after `date` on which `habit` has a Scheduled Opportunity, or null if
 * none is found within `maxLookaheadDays` (default 366 -- generous enough to cover any weekly
 * pattern, including a habit paused indefinitely with no future unpaused period). Purely a
 * forward walk using the same isScheduledOpportunity primitive every other schedule calculation
 * already uses -- no new schedule concept, just the missing directional counterpart to
 * scheduledOpportunitiesUpTo.
 */
export function nextScheduledOpportunityAfter(
  periods: HabitSchedulePeriod[],
  habit: Habit,
  date: string,
  maxLookaheadDays = 366,
): string | null {
  let cursor = addDays(date, 1);
  for (let i = 0; i < maxLookaheadDays; i += 1) {
    if (isScheduledOpportunity(periods, habit, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}
```

If a habit is paused indefinitely (no future unpaused period), this correctly returns `null` — suppression then has no natural reset date, so the card simply doesn't reappear until the user unpauses the habit (at which point `openLapse` and the schedule both become live again). No special-case handling needed for this; it falls straight out of the function's own definition.

### 2.5 Gap 4 — deriving suppression from a synced fact instead of a local one

This is the direct response to the suppression-persistence issue raised in review: wherever an action already writes a synced `LapseReasonEntry` (Skip and Reflect — see §4), suppression should be **computed from that record**, not from a second, unrelated local-only entry. This is a pure function, safe to add alongside `openLapse` in `lib/domain/recovery.ts`:

```ts
/**
 * Whether the recovery card should currently be suppressed for `habit` because of a synced
 * LapseReasonEntry written during the *current* open lapse (i.e. created on or after the lapse's
 * firstMissedDate) -- the mechanism behind Skip and Reflect's suppression in §3.4. Returns the
 * date suppression lifts, or null if no relevant entry exists (nothing to suppress from this
 * source -- callers still need to check the local-only fallback for Continue/dismiss, §8.6).
 * Deliberately keys off each entry's createdAt (when the action was actually taken), not its
 * missedOpportunityDate (what the action's fact is about) -- see §4.1 for why those two dates
 * differ for a Skip-originated row.
 */
export function lapseReasonSuppressionUntil(
  habit: Habit,
  periods: HabitSchedulePeriod[],
  lapseReasons: LapseReasonEntry[],
  openLapseStart: string,
  today: string,
): string | null {
  const relevant = lapseReasons.filter(
    (entry) => entry.habitId === habit.id && localDayKeyOf(entry.createdAt) >= openLapseStart,
  );
  if (relevant.length === 0) return null;
  const mostRecent = relevant.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return nextScheduledOpportunityAfter(periods, habit, localDayKeyOf(mostRecent.createdAt));
}
```

This needs no new field on `LapseReasonEntry` and no new table — `createdAt` already exists on every record for last-write-wins sync (see CLAUDE.md's `updatedAt`/`createdAt` convention), and `localDayKeyOf` already exists in `lib/domain/day-key.ts`. It also means a habit that gets skipped or reflected-on repeatedly across a long, unresolved lapse simply accumulates one `LapseReasonEntry` per engaged day, and suppression always tracks the *most recent* one — which is exactly the intended behaviour (see the reappearance rule in §3.4).

### 2.6 Nothing else in `lib/domain/` changes

`momentum.ts`, `config.ts`, `day-key.ts`, and `challengeProgress` all consume `isDoneOnDay`/`isScheduledOpportunity` already and need no direct changes — schedule-aware challenge tolerance for a mid-challenge pause, for instance, already works today (see §7).

---

## 3. The Recovery Card

### 3.1 Trigger condition — answering the spec's open question directly

A habit's card-eligibility is:

```
openLapse(habit, schedulePeriods, logs, today) !== null
  AND isScheduledOpportunity(schedulePeriods, habit, today)
  AND today >= suppressedUntil(habit)   // see §3.4 -- null/absent counts as "not suppressed"
```

Where `suppressedUntil(habit)` is the later of two independently-computed dates (§3.4): `lapseReasonSuppressionUntil(...)` (§2.5, derived from synced `LapseReasonEntry` rows — covers Skip and Reflect) and the local-only dismissal record's `suppressUntil` (covers Continue today and ✕). Either, both, or neither may be present at a given moment; the card is suppressed if today hasn't reached whichever is later.

Recommendation: **require today to be a Scheduled Opportunity.** This is the least intrusive rule available, for a concrete reason — if today isn't scheduled for this habit (it's paused, or it's a Tue/Thu habit and today's Wednesday), there is nothing actionable to offer ("Continue today" is meaningless with no today to continue). Showing the card anyway would make it exactly the kind of ambient, unresolvable guilt banner the spec explicitly forbids. Gating on today being scheduled means the card only ever appears on a day the user can actually do something about it.

### 3.2 Placement on Today

Directly below the header block (date + "N of M done today"), above the active-challenge banner(s) and above the habit list. Recovery is the most important available action on a day it applies, so it leads — consistent with Phase 3's "narrative before numbers" ordering applied to Today's own hierarchy.

### 3.3 One card, never a stack

If more than one habit is simultaneously eligible, Today shows **exactly one** combined card ("A few habits are ready for you" style copy, illustrative not final), never one card per habit. Expanding it reveals a short list, one line per eligible habit, each opening that habit's own six-option panel. This is a small explicit product decision (§8) worth approving because it's the one place this plan invents a new layout rule not dictated by the spec text.

### 3.4 Dismiss and reappearance

**One consistent suppression duration for all four actions.** Whichever of Continue today, Skip for today, dismiss (✕), or Reflect the user picks, the recovery card stays hidden for that habit only until its **next Scheduled Opportunity** — never for the remainder of the current open lapse. If the habit still isn't done by then, the card is eligible to reappear (subject to the same base trigger condition in §3.1), and whatever the user does at that point (including doing nothing and letting it reappear again the time after that) starts the same bounded cycle over. This is what the required outcome — "suppressing the card must never permanently remove recovery support for the remainder of an unresolved lapse" — means concretely: a long, unresolved lapse gets checked back on at every subsequent Scheduled Opportunity, not just once.

The four actions still record different facts, and that's where they genuinely differ now:

| Action | Fact recorded | Recorded via |
|---|---|---|
| **Continue today** | None. | — |
| **Skip for today** | An intentional skip (`LapseReasonEntry`, `reason: null, skipped: true`). | `addLapseReason(...)` |
| **Reflect** | The selected lapse reason (`LapseReasonEntry`, `reason: <key>`) or, if the user taps Reflect's own internal Skip, the same `reason: null, skipped: true` shape. | `addLapseReason(...)` |
| **Dismiss (✕)** | None. | — |

**How suppression is derived — two mechanisms, chosen to prefer durable synced facts wherever one exists:**

**Skip and Reflect — derived from the synced fact, no local storage at all.** Both already write a `LapseReasonEntry`; suppression is computed live from that record via `lapseReasonSuppressionUntil` (§2.5): find the most recent `LapseReasonEntry` for this habit created during the current open lapse, and suppress until `nextScheduledOpportunityAfter` of the day that entry was created. Nothing new is stored for suppression purposes — the same record Phase 5's coach will read is the only thing consulted. Because `lapseReasons` is a synced table (§4.3), this is automatically consistent across every device the user is signed into, and unaffected by reinstalling the app or clearing local storage: as soon as the account re-hydrates and pulls `lapseReasons` + `habit_schedule_periods` (the existing sign-in/foreground pull described in CLAUDE.md's sync layer), the derivation reproduces the identical result. There is one small, accepted latency window: since this app has no realtime subscription (by design, per CLAUDE.md), a Skip recorded on one device is only visible on another device after that device's next pull (sign-in or foreground) — the same latency every other synced fact in this app already has, not a new limitation introduced here.

**Continue today and dismiss (✕) — no fact exists to derive from, so this remains device-local.** These two actions are defined by recording nothing, so there is no synced anchor to compute suppression from later. §8.6 documents this decision and its limitations in full; the short version: a local record `{ habitId, suppressUntil: nextScheduledOpportunityAfter(schedulePeriods, habit, today) }` is written to the same local-only store as before (`lib/recovery-card-dismissals.ts`), and the gap this leaves (another device, or this device after a reinstall, won't know about it) is bounded and self-limiting now that the window itself is only ever "until the next Scheduled Opportunity" rather than a whole lapse — at most one extra, easily-dismissed appearance of the card, never an ongoing nag.

**Combining the two.** The card's actual suppression check (§3.1) takes the *later* of whichever of the two sources currently has a value for that habit — in the ordinary case only one of them will be set at a time (the user just took one action), but taking the max keeps the check correct if, say, the user dismissed yesterday and skips again today.

**Reset.** Neither mechanism needs an explicit "reset" step. The synced-fact derivation is a pure function of existing data — it naturally stops applying once `today >= suppressUntil`, and there is nothing to go stale, since `LapseReasonEntry` rows are kept as permanent behavioural history regardless of whether they're still suppressing anything. The local-only record is checked the same way (`today >= suppressUntil`); once true, it's simply ignored — a harmless orphaned entry, not worth a cleanup job for what's realistically a handful of small records per habit. Either way, the moment the lapse itself resolves (`openLapse` returns null), §3.1's base condition already excludes the card regardless of any suppression state, so a resolved lapse can never falsely suppress a *future*, unrelated lapse.

### 3.5 The six options

The card expands (one tap) into the six options from the locked spec. None of the six are ever pre-selected or forced — dismissing via "Continue today" always works with zero engagement below it.

| Option | Behaviour | New store/domain surface used |
|---|---|---|
| **Continue today** | Dismisses the card. No data written. Suppresses this habit's card until its next Scheduled Opportunity, stored locally (§3.4, §8.6). | — |
| **Do a smaller version** | Only rendered when `reducedTargetFor(habit) !== null` (§2.3) — i.e. habits with a measurable target (today, exactly `type === 'count'`; see §8.1). One tap logs today's completion at the reduced target, flagged `reduced: true`, then dismisses the card. Runs through the same celebration pipeline as a normal log (see §3.6). | `logReducedCompletion(habitId)` (new store action) |
| **Skip for today** | Writes a `LapseReasonEntry` (`skipped: true, reason: null`) and dismisses the card. Suppression is derived from that same record, not stored separately (§3.4, §2.5) — until the habit's next Scheduled Opportunity, same duration as every other option. | `addLapseReason(...)` (new store action, same one Reflect uses) |
| **Adjust the schedule** | Navigates to `/habit-form?id=<habitId>` — the existing "Edit habit" modal, which gains a Schedule section in this phase (§6). Not a new screen (see §6.1 for why). | — |
| **Pause this habit** | One tap. Appends a new `HabitSchedulePeriod` (`effectiveFrom: today`, `paused: true`, `days` carried over from the currently active period) and dismisses the card. No confirmation dialog — pausing is trivially reversible (just add another period), so adding a confirm step here would violate the flow's own one-tap principle for no real safety benefit. | `pauseHabit(habitId)` (new store action, thin wrapper over `addSchedulePeriod`) |
| **Reflect** | Expands the Lapse Reason prompt (§4) inline within the same card — not a new screen or route. Writes a `LapseReasonEntry` with the chosen reason (or `skipped: true, reason: null` if the user taps Reflect's own internal Skip); suppression is derived the same way as "Skip for today" (§3.4, §2.5). | `addLapseReason(...)` (new store action) |

### 3.6 Celebration copy for a reduced completion

Reuses the existing `useCelebration` pipeline unchanged (haptics/chime/confetti — no new reward channel, per constraints). If the reduced completion also happens to be a Recovery Event (`isRecoveryEvent` — it usually will be, since it's resolving an open lapse), the existing `big: true` recovery celebration fires; the *copy* should acknowledge the smaller scope without ever framing it as lesser, e.g. (illustrative, not final): *"A smaller version still counts. Your progress is still moving."* This is a copy-only addition to the existing `RECOVERY_MESSAGES`/routine-message branching in `app/(tabs)/index.tsx`'s `handleLog`-adjacent logic, not a new celebration mechanism.

---

## 4. Lapse Reasons

### 4.1 Data model

New type in `lib/habit-types.ts`:

```ts
export type LapseReasonKey = 'too_busy' | 'forgot' | 'low_energy' | 'not_feeling_it' | 'something_else';

export type LapseReasonEntry = {
  id: string;
  habitId: string;
  /**
   * The Scheduled Opportunity date this entry is about. For a Reflect-originated row this is the
   * open lapse's firstMissedDate (Reflect engages with the lapse as a whole); for a card-level
   * "Skip for today" row this is simply today's date, since that action is about today's specific
   * opportunity, not the lapse's origin -- see docs/phase-4-plan.md section 4.1.
   */
  missedOpportunityDate: string;
  reason: LapseReasonKey | null; // null when skipped
  note?: string; // optional free text, 'something_else' only
  skipped: boolean;
  createdAt: string;
  updatedAt: string;
};
```

`HabitState` gains `lapseReasons: LapseReasonEntry[]`.

Per Amendment 2, a row is now written by **two** distinct paths, not just one: tapping **Skip for today** directly from the card (§3.4 — `reason: null, skipped: true, missedOpportunityDate: dayKey()`), or opening **Reflect** and either choosing a reason or tapping its own internal Skip (`missedOpportunityDate: openLapse.firstMissedDate` in this path). Both paths converge on the same row shape deliberately — from a future-coaching perspective, "skipped via the card" and "opened Reflect, then chose not to explain" are the same signal (an acknowledged, unexplained miss), and giving them separate provenance would be more than this "lightweight distinction" needs.

Dismissing via **Continue today** or **✕** still never writes a row — that remains the one true "no interaction" case. This is exactly the distinction the spec's "whether skipped" field and Amendment 2 both ask for: a `LapseReasonEntry` with `skipped: true` means the user was presented the option and declined to elaborate; no entry at all means the user never engaged with the recovery framing in the first place. Phase 5's coach can treat these very differently.

Note the two dates on this type serve different purposes and are deliberately not the same field: `missedOpportunityDate` is analytical metadata (what the reflection is *about*, for Phase 5's coach), while `createdAt` (already present on every synced record for last-write-wins purposes) is what §2.5's `lapseReasonSuppressionUntil` actually keys off to compute how long the recovery card stays quiet. No new field is needed for suppression to work.

### 4.2 UI

One tap, always skippable, per the spec verbatim. Five tappable chips (four fixed reasons + "Something else"); selecting "Something else" reveals a single-line optional text input beneath it. Selecting any option (or the free-text field's own implicit submit) immediately writes the row and returns to normal Today — no confirmation step, no second screen.

### 4.3 Database & sync

New table, additive, following the exact pattern `supabase/habit_schedule_periods_schema.sql` already established (append-only from the client's perspective, RLS scoped to `auth.uid()`, rollback comment):

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

-- ROLLBACK: drop table if exists public.lapse_reasons;
-- Safe at any time -- no other table depends on it, and nothing reads it until Phase 5's coach.
```

Sync wiring in `lib/supabase-sync.ts` mirrors `habit_schedule_periods` exactly: `lapseReasonToRow`/`rowToLapseReason`, added to `RemoteChanges`, `pullRemoteChanges`, `enqueueFullUpload`, and `diffAndSync` (append-only — additions only, no delete branch, same as schedule periods). `habit-store.tsx`'s `mergeRemote` gains the same add-or-accept-newer-by-id merge as `schedulePeriods`.

This data isn't consumed anywhere in Phase 4 beyond being written — it exists to feed Phase 5's coach, per the spec. No screen in this phase reads it back.

---

## 5. Reduced Completions

### 5.1 Data model

`lib/habit-types.ts`:

```ts
export type Habit = {
  // ...existing fields
  /** Explicit smaller target for "Do a smaller version" (habits with a measurable target only —
   * today, exactly type === 'count'). Falls back to a derived default (see reducedTargetFor)
   * when unset. */
  reducedTarget?: number;
};

export type HabitLog = {
  // ...existing fields
  /** True when this entry is a reduced ("smaller version") completion, not the full target. */
  reduced?: boolean;
};
```

Both fields are optional additions — no migration function is needed beyond what already exists for every other optional field on these types (`reminderTimes` set the precedent in Phase 1/2; absent-key reads as `undefined` and every consumer already treats `undefined` as "not set").

### 5.2 Store action

```ts
logReducedCompletion(habitId: string): void
```

Reducer case creates one `HabitLog` for today with `count: reducedTargetFor(habit)` and `reduced: true`. A single log entry, not a stepper interaction — "Do a smaller version" is a one-tap action from the card, matching the flow's own one-tap principle, not a scaled-down version of the count stepper.

### 5.3 Habit form

`app/habit-form.tsx` gains, only for habits with a measurable target (today, exactly `type === 'count'`), an optional "Smaller version" stepper directly beneath the existing "Daily target" stepper, defaulting to `reducedTargetFor({ ...draft, reducedTarget: undefined })`'s derived value so the field is pre-filled with a sensible number rather than empty. Validated client-side to stay in `[1, targetCount - 1]` (see edge case in §7).

### 5.4 Database & sync

Additive columns, in the same new migration file as lapse reasons (§4.3, consolidated as one file for this phase — see §9):

```sql
alter table public.habits add column if not exists reduced_target int;
alter table public.habit_logs add column if not exists reduced boolean not null default false;

-- ROLLBACK:
-- alter table public.habits drop column if exists reduced_target;
-- alter table public.habit_logs drop column if exists reduced;
-- Safe at any time -- existing rows read back with reduced_target null / reduced false, which is
-- exactly the pre-Phase-4 behaviour every consumer already falls back to.
```

`habitToRow`/`rowToHabit` and `logToRow`/`rowToLog` in `lib/supabase-sync.ts` gain the two fields, same shape as every other optional field already round-tripped there (e.g. `target_count`).

---

## 6. Schedule Editor & Pause

### 6.1 Where it lives — folded into the existing "Edit habit" modal, not a new screen

CLAUDE.md is explicit that the app's felt surface area is 8 screens (4 tabs + 4 infrequent flows), and the master spec's Phase 10 language ("do not increase the app's surface area... unless a recovery screen or small modal is genuinely necessary") puts the burden of proof on adding a 9th. A schedule editor is exactly the kind of infrequent, per-habit configuration that already has a home: `app/habit-form.tsx`, opened from Habit Detail's "Edit habit" button and now also from the recovery card's "Adjust the schedule" option (`router.push('/habit-form?id=' + habitId)`, the existing route). Recommendation: add a **Schedule** section to `habit-form.tsx`, visible only when `isEditing`, rather than a new route. This is the single largest structural decision in this plan and is called out for approval in §8.3.

### 6.2 UI

A day-of-week picker (7 toggle chips, S M T W T F S, matching the existing segmented-control visual language in `habit-form.tsx`) plus a "Paused" switch, seeded from the habit's currently active period (`scheduleForDate(schedulePeriods, habit.id, dayKey())`) or the daily/unpaused default if none exists. No time-of-day control, per the spec's explicit scope limit.

### 6.3 Write behaviour

On Save, if the selected `{ days, paused }` differs from the currently active period, append one new `HabitSchedulePeriod` with `effectiveFrom: dayKey()` — never edit an existing period, per Phase 2's append-only design. If unchanged, no new period is written (avoids an empty history of no-op periods every time the form is saved for an unrelated reason like renaming the habit).

```ts
addSchedulePeriod(habitId: string, days: ScheduleDays, paused: boolean): void
```

If the habit belongs to an active challenge, `habit-form.tsx` shows the same style of informational note it already shows for type changes ("This habit has an active challenge...") — informational only, never a block. See §7 for why no functional guard is needed.

---

## 7. Retroactive Entry

### 7.1 Where it's accessed

`app/habit/[id].tsx`'s existing 28-day calendar grid (`components/habit-calendar.tsx`). `HabitCalendar` gains one new, optional prop:

```ts
onDayPress?: (date: string) => void;
```

Only cells within the last 7 days (`date >= addDays(dayKey(), -6)`) become pressable when the prop is supplied; Progress's existing usage of the same component passes nothing and is visually and behaviourally unchanged. Tapping an eligible day opens a small inline panel (not a new screen) showing that date, the habit's current logged state, and:

- **Simple habits**: a single "Mark done" / "Mark not done" toggle.
- **Count habits**: a stepper for that day's total count, same visual pattern as Today's count stepper.

### 7.2 The 7-day limit

Strictly `today` back through 6 days ago (7 days total). Today itself continues to use the existing Today-tab checkbox/stepper — the retroactive panel is for the 6 days *before* today, since today already has a first-class, always-visible editor and duplicating it here would be redundant. Beyond day −6, the calendar cells render exactly as they do today: inert.

### 7.3 The one new store primitive covers both directions

```ts
setLogAmountForDate(habitId: string, date: string, amount: number): void
```

Implementation: remove every existing log row for `(habitId, date)`, then — if `amount > 0` — insert exactly one new row with that count. This single primitive handles **both** directions the spec calls for:

- **Adding a missing completion**: previously 0 logs that day, `amount > 0` inserts one.
- **Removing or correcting an existing completion**: previously some count, `amount = 0` removes it entirely; a different positive `amount` corrects it.

This deliberately does **not** set `reduced: true` under any circumstance — retroactive editing corrects a count, it does not retroactively invent a "smaller version" designation. `reduced` is only ever set live, through the Recovery Flow's own action (§5.2). This is a scoping decision, listed in §8.4.

Because this replaces old log ids with a new one, the existing `diffAndSync` diff-by-id logic (`lib/supabase-sync.ts`) requires no changes at all: it already enqueues a delete for ids that disappeared and an upsert for the new id, which is exactly what a "corrective replacement" needs.

### 7.4 Recomputation behaviour, both directions

Nothing here is a special case in the domain layer — this is a direct, deliberate consequence of Phase 2's "nothing is cached, everything is recomputed on read" design, already exercised by worked example F in `docs/phase-2-implementation-plan.md` §3 (a retroactively-added completion that closes a lapse makes that lapse disappear from Recovery Rate's denominator/numerator and un-fires the Recovery Event it had produced, purely by recomputing fresh).

**The reverse direction, worked through explicitly** (removing a completion that had previously closed a lapse):

| | Before removal | After retroactively removing the day-3 completion |
|---|---|---|
| Logs | 07-01 miss, 07-02 miss, 07-03 completed | 07-01 miss, 07-02 miss, 07-03 miss |
| `recoverableLapseInstances` pair (07-02, 07-03) | `recovered: true` | Pair now `recovered: false` (07-03 is a miss); if 07-04 exists and is a miss too, a *new* pair (07-03, 07-04) also appears |
| Recovery Rate | +1 resolved / +1 recovered | Reverts by 1 recovered (denominator may grow by 1 more if a new pair now exists past 07-03) |
| `closedLapses` | one closed lapse, 07-01→07-03 | that lapse is no longer closed; it merges into whatever open run now extends from 07-01 forward |
| Recovery Event on 07-03 | present | gone (07-03 is no longer a completion at all, so it can't be an event) |

No stored Recovery Event, Recovery Count, or "Total Completions was already 143, don't undo it" ledger needs reconciling, because none of these are stored — the next render of Progress/Habit Detail simply reflects the corrected picture. This is explicitly **not a bug to guard against**: Recovery Rate and Recovery Count are framed throughout this product as a rolling behavioural signal, not an achievement ledger (Phase 3 already committed to "no badges, no points" as a non-goal), so a corrected history producing a corrected, possibly lower, Recovery Count is the system working as designed. No confirmation dialog beyond the existing generic "are you sure" pattern (`confirmAction`) is needed when *removing* a day's completion — same treatment as any other correction, not a special warning about metrics moving.

---

## 8. Product Decisions Requiring Approval

### 8.1 Reduced completions: habits with measurable targets only, never simple habits

The spec's "explicitly configured reduced target or a measurable target" is an *or* — for a habit with a measurable target, having a `targetCount` already satisfies that clause, so `reducedTargetFor` can always derive a sensible default even without explicit configuration. Today, `targetCount` exists only on `type: 'count'` habits — the data model has exactly one kind of measurable target, not several — so "habits with measurable targets" and "count-type habits" currently describe the identical set. This plan uses the spec's own phrase throughout; `reducedTargetFor`'s actual `habit.type !== 'count'` check (§2.3) is today's complete membership test for that set, not a narrower policy choice, and would need to broaden only if a future habit type introduced a second kind of numeric target. For simple (yes/no) habits there is no numeric target to derive a smaller version *from*, and no UI is proposed in this phase to let a user configure one (doing so would mean inventing a new secondary interaction for simple habits with no spec basis). Recommendation: `reducedTargetFor` returns `null` for every simple habit, unconditionally, and "Do a smaller version" simply never renders for them. This is the most literal reading of "do not invent an automatic reduced version for simple yes/no habits" available without adding scope.

### 8.2 "Continue today" and "Skip for today" are now distinct (revised per approval feedback)

The version of this plan originally submitted made both options a pure dismiss with identical behaviour, reasoning that no domain concept existed for "explicitly excused." On reconsideration, that undersold what's actually available: `lapse_reasons` (§4) is a purely additive, informational table with **no** consumer anywhere in `lib/domain/` — nothing about Recovery Rate, Recovery Time, Momentum State, Consistency, or `challengeProgress` reads it, now or in this plan. That means there is **no architectural reason** the two options must be identical; a distinction can be added with zero risk to any existing metric, satisfying the "preserves the existing recovery metrics" requirement by construction rather than by careful avoidance.

Revised design:

- **"Continue today"** stays a true no-op — no data written, matching "no interaction happened" as literally as possible.
- **"Skip for today"** now writes a `LapseReasonEntry` with `reason: null, skipped: true` (§4.1) — a lightweight, explicit "I saw this and I'm not doing it today" signal, distinct from silence. This costs nothing architecturally (same table, same sync path already being built for Reflect in §4) and gives Phase 5's coach a real signal to work with: an acknowledged, unexplained skip reads very differently from a habit the user appears to have simply forgotten existed.
- Neither option changes `isDoneOnDay`, `openLapse`, or any other Phase 2 metric — the day is still, correctly, a miss if nothing is logged. The distinction is purely additive metadata about the user's *awareness* of the miss, never a backdoor way to make a missed day look completed.
- **Revised again per the suppression-consistency review**: the two options no longer differ in *how long* they suppress the card — both now suppress only until the habit's next Scheduled Opportunity (§3.4), using the new `nextScheduledOpportunityAfter` domain primitive (§2.4). The earlier version of this decision gave "Continue today" the longer, whole-lapse suppression on the theory that an unengaged dismiss deserved more quiet than an engaged one; on reconsideration, a uniform duration is simpler, matches the explicit instruction that no action may "permanently remove recovery support for the remainder of an unresolved lapse," and still leaves the two options meaningfully different where it actually matters — the fact recorded, not the quiet period.

This keeps the six-option list matching the locked spec exactly, with all six now behaviourally distinct in what they record, and all four card-level actions (Continue today, Skip for today, dismiss, Reflect) sharing one consistent suppression rule.

### 8.3 Schedule editor folds into the existing habit-form modal, not a new screen

Covered in full in §6.1. This is the plan's one meaningful screen-count judgment call, parallel to Phase 3's own single deviation (folding Reflection/Coach into Progress instead of new screens).

### 8.4 Retroactive editing never sets the `reduced` flag

Covered in §7.3. Reduced completions are a live, in-the-moment Recovery Flow action only.

### 8.5 One combined recovery card, never a stack

Covered in §3.3.

### 8.6 Continue today / dismiss keep device-local suppression; no new table is introduced

This is the direct response to the persistence issue raised in review, and the one place this revision keeps a design that isn't fully synced — documented explicitly per that instruction.

**What was considered.** Two options were weighed for "Continue today" and dismiss (✕), which by definition record no behavioural fact (§3.4): (a) add a small synced "recovery card acknowledgement" table purely to persist that these two actions were taken, or (b) keep them device-local, as originally designed, and document the gap.

**Decision: (b), device-local, no new table.** Reasoning:

- Introducing a synced table whose entire purpose is to record "the user tapped a button that we've defined as recording nothing" is a direct contradiction of what makes these two actions distinct from Skip and Reflect in the first place (§3.4's fact table). Giving them a synced footprint would blur exactly the line Amendment 2 draws between "an acknowledged skip" and "no interaction."
- The cost is disproportionate to the problem. A new table means a new migration, new RLS policy, new sync-layer plumbing (`RemoteChanges`, `pullRemoteChanges`, `diffAndSync`, `mergeRemote`), and a new lifecycle to reason about — for a gap that, now that suppression is capped at "until the next Scheduled Opportunity" rather than a whole lapse, is small and self-limiting (see below).
- It's UI state, not behavioural data. Nothing about `Habit`, `HabitLog`, `HabitSchedulePeriod`, or `LapseReasonEntry` needs this information; the only consumer is "should this card currently render," which is exactly what the app's existing local-only patterns (the `skipNextDiffRef` flag, the sync watermark) are for.

**Schema and lifecycle (since no new table exists, this is what actually gets built instead).** A single `AsyncStorage`-backed key-value store, `lib/recovery-card-dismissals.ts`, holding `{ habitId, suppressUntil }` entries, written when "Continue today" or ✕ is tapped (`suppressUntil = nextScheduledOpportunityAfter(schedulePeriods, habit, today)`), read by the card's trigger check (§3.1), never synced, never migrated, and never explicitly deleted — a stale entry (`today >= suppressUntil`) is simply ignored by the read path, the same "harmless orphaned row" treatment already used elsewhere in this plan (§3.4).

**Documented limitations:**

- **Cross-device**: a "Continue today"/✕ tap on one device is invisible to any other device the account is signed into. If the same open lapse is still showing on a second device, the card may appear there even though the user already dismissed it elsewhere.
- **Reinstall / local storage cleared**: the dismissal is lost; the card may reappear once on that device even though it was already dismissed moments before.
- **Why this is acceptable now, when it might not have been under the previous (whole-lapse) design**: because suppression is capped at one Scheduled Opportunity's worth of time (§3.4), the practical exposure from either gap is small and bounded — at most one extra appearance of a lightweight, one-tap, non-blocking card, never a recurring nag, and never a state that silently persists for the life of a multi-week lapse the way the original whole-lapse version of this gap could have. Skip and Reflect, the two actions that actually record something worth persisting, do not have this limitation at all (§3.4).

---

## 9. Proposed Commit Sequence

Ordered domain-and-data-first, then UI in the same order the spec lists the six options, retroactive editing last (most self-contained, least urgent), docs last.

1. **Data model + migrations, no behaviour change.** `lib/habit-types.ts` (`reducedTarget`, `reduced`, `LapseReasonKey`, `LapseReasonEntry`, `HabitState.lapseReasons`), `lib/domain/persistence.ts` (`migrateLapseReasons`, wired into `initialState`/hydration exactly like `migrateSchedulePeriods`), and the new `supabase/phase-4-recovery-flow-schema.sql` (lapse_reasons table + the two additive columns, with rollback comments, per §4.3/§5.4). No UI, no new domain functions yet — purely additive shape.

2. **Domain logic.** `openLapse` in `lib/domain/recovery.ts` (§2.1), the `isDoneOnDay` reduced-aware change in `lib/domain/habit-stats.ts` (§2.2), `reducedTargetFor` (§2.3), `nextScheduledOpportunityAfter` in `lib/domain/schedule.ts` (§2.4), and `lapseReasonSuppressionUntil` in `lib/domain/recovery.ts` (§2.5). Extend `lib/domain/recovery.test.ts` / `lib/domain/habit-stats.test.ts` / `lib/domain/schedule.test.ts` with new fixtures covering: an open lapse mid-run, an open lapse resolved by a reduced completion, the retroactive-removal worked example from §7.4, a daily vs. a weekday-limited habit's next Scheduled Opportunity, and suppression derived from a `LapseReasonEntry` written on various days within an open lapse. Run `npm run build:edge-functions` and re-paste both regenerated Edge Functions into the Supabase Dashboard as part of this commit (required per §2.2 — `isDoneOnDay` is in the generated whitelist).

3. **Sync plumbing.** `lib/supabase-sync.ts` (lapse-reason row mapping + the two new habit/log columns), `lib/habit-store.tsx` (`mergeRemote` for `lapseReasons`, and the new actions: `addLapseReason`, `addSchedulePeriod`, `pauseHabit`, `logReducedCompletion`, `setLogAmountForDate`). No UI yet — every new action is reachable only from tests/dev tools at this point.

4. **Recovery card shell.** New `components/recovery-card.tsx` + `lib/recovery-card-dismissals.ts` (the local-only store, §8.6 — used only by Continue today/✕), wired into `app/(tabs)/index.tsx` per §3.1–3.4: trigger logic (combining the local store with `lapseReasonSuppressionUntil` from commit 2, per §3.1's "later of the two" rule), placement, and "Continue today"/✕ (local dismiss, next-opportunity suppression). "Skip for today" can also be completed in this commit — it only needs `addLapseReason` (already available from commit 3) and the same `lapseReasonSuppressionUntil` derivation already wired for the trigger check, so it doesn't depend on the fuller Reflect UI. "Adjust the schedule," "Pause this habit," and "Reflect" can render as disabled/stub rows here and come alive in the next three commits.

5. **Do a smaller version.** `logReducedCompletion` wiring, the habit-form "Smaller version" stepper (§5.3), and the reduced-completion celebration copy (§3.6).

6. **Pause this habit.** One-tap `pauseHabit` wiring from the card (§3.5).

7. **Adjust the schedule.** The Schedule section in `habit-form.tsx` (§6.2–6.3), card option navigates there.

8. **Reflect.** The lapse-reason prompt UI (§4.2) wired to `addLapseReason`. No separate suppression wiring needed — Reflect reuses the exact same `lapseReasonSuppressionUntil` derivation already wired for the trigger check and for "Skip for today" in commit 4.

9. **Retroactive entry.** `HabitCalendar`'s `onDayPress` prop (§7.1), the inline correction panel on Habit Detail, `setLogAmountForDate` wiring, the 7-day gating (§7.2).

10. **Docs.** Update `CLAUDE.md` per the Global Implementation Constraints — new domain functions, new store actions, the habit-form Schedule section, the recovery card, and the new `lapse_reasons`/column additions, following the existing file's documentation style.

---

## 10. Edge Cases

- **Pausing every habit.** No new handling needed. A fully-paused habit set generates no Scheduled Opportunities, so no recovery card can ever trigger (the "today must be scheduled" gate in §3.1 already excludes it), and Today's core loop degrades to the same "nothing to log" state a zero-habit account already produces — pre-existing, not new to Phase 4.
- **Reduced target equal to (or above) the full target.** Prevented at the source: `reducedTargetFor`'s derived default is always `< targetCount` by construction (`/3`, floor 1), and the habit-form stepper for an explicit `reducedTarget` is clamped client-side to `[1, targetCount - 1]` (§5.3). No domain-layer guard needed since the invalid state can't be produced by the only UI that writes it.
- **A retroactive entry closes a lapse already counted in Recovery Rate.** Not an edge case requiring special code — this is the designed behaviour of a fully-derived domain layer, worked through in §7.4. The count moving is correct, not a bug to suppress.
- **Schedule changes affecting an in-progress challenge.** Already handled by Phase 2: `challengeProgress`'s `allDoneOnDay` calls `isScheduledOpportunity` per habit per day, so a habit paused mid-challenge (effective today onward, per the append-only design) simply stops being blamable for missed days from that point forward — no domain change needed. One acknowledged, pre-existing tension is *not* solved here: a user could pause a habit specifically to dodge a challenge failure. That's inherited from Phase 2's design and is explicitly Phase 7's job (challenge tolerance redesign), not Phase 4's.
- **A lapse that stays open across many Scheduled Opportunities.** Intentional, not a bug: since every action's suppression is capped at one Scheduled Opportunity (§3.4), the card can reappear at every subsequent opportunity the lapse remains unresolved — for a daily habit, potentially once a day. This is the explicit required outcome ("recovery support" must never be permanently withdrawn from an unresolved lapse), and it stays low-friction because every reappearance still offers the same one-tap "Continue today" exit with zero forced engagement (§3.1, §3.4) — it is a repeated *offer*, never a repeated *demand*.
- **Skip or Reflect recorded on a device, then the app is opened on a second device (or reinstalled) before the next sync pull.** Covered in §3.4 and §8.6: Skip/Reflect suppression is correct as soon as that device's next pull brings in the new `LapseReasonEntry` (the same latency every synced fact in this app already has); Continue/dismiss suppression is device-local by design (§8.6) and may show the card again once on the other device — bounded, not a recurring issue.

---

## 11. Notification linkage (Phase 8, not built here)

The spec's morning-after push notification and this card are two halves of one user journey: the notification (Phase 8) is what could bring a lapsed user back into the app; this card (Phase 4) is what they see once they're in it. `lib/notifications.ts` is untouched by this plan — no new scheduling triggers are added. Noted here only so the linkage is on record, per the instruction; no Phase 8 work is implied or begun.

---

## 12. Open Questions

- Final copy for the recovery card, the reduced-completion celebration, and the lapse-reason prompt — deferred to implementation, following Phase 3's own precedent of approving structure now and polishing wording during the build (subject to the existing no-em-dash, no-shame, adult-tone rules).
- Whether "Adjust the schedule" should deep-link into a scrolled/focused Schedule section within `habit-form.tsx`, or simply open the form at the top and let the user scroll — a minor UX detail, not a structural one; recommend the deep-link if trivial to add, otherwise defer without blocking the rest of the phase.
- The `/3` reduced-target default ratio (§2.3) is a tunable, not a structural decision — worth a quick sanity check against a few real habits during implementation, but not something that needs sign-off before starting.

---

## Summary

Phase 4 adds one dismissible, non-blocking card to Today, gated on a genuinely actionable open lapse (§3.1), offering six lightweight options — all six behaviourally distinct in what they record (§8.2), all four card-level actions sharing one consistent suppression duration (§3.4) — that map to three new domain functions (`openLapse`, `nextScheduledOpportunityAfter`, `lapseReasonSuppressionUntil`), one modified domain function (`isDoneOnDay`, made reduced-completion-aware), one new pure helper (`reducedTargetFor`), two new `Habit`/`HabitLog` fields, one new database table, and five new store actions. No new screens are added — schedule editing folds into the existing "Edit habit" modal (§8.3), and retroactive editing folds into the existing Habit Detail calendar (§7.1). Every migration is additive and reversible (§4.3, §5.4). Six decisions are flagged in §8 for explicit approval; three open questions in §12 are copy/tuning details that don't block a start.

No code, schema, or copy has been changed. Waiting for approval before beginning Phase 4 implementation.

---

## Suppression Revision — Change Log

This section documents the changes made in this revision, in response to the two issues raised: inconsistent suppression durations across the four recovery-card actions, and device-local-only suppression persistence.

### What changed

1. **Unified suppression duration.** All four card actions — Continue today, Skip for today, dismiss (✕), and Reflect — now suppress the recovery card only until the habit's next Scheduled Opportunity (§3.4). Previously, Continue today/dismiss/Reflect suppressed for the entire remaining duration of the open lapse while Skip for today alone used the shorter window; that inconsistency is resolved by shortening the other three to match Skip, not by lengthening Skip, since the required outcome is that no action may permanently withdraw recovery support from an unresolved lapse.
2. **New domain function `lapseReasonSuppressionUntil`** (§2.5, `lib/domain/recovery.ts`), which derives a suppression date directly from the most recent `LapseReasonEntry` written during the current open lapse, using the already-planned `nextScheduledOpportunityAfter` (§2.4) underneath it.
3. **Skip for today and Reflect no longer write a separate local suppression record.** Both already write a synced `LapseReasonEntry`; suppression for both is now derived live from that record via `lapseReasonSuppressionUntil`, making it automatically consistent across devices and durable across reinstalls/local-storage clears (§3.4).
4. **Continue today and dismiss (✕) keep local-only suppression**, unified into the same duration rule as the other two actions. This was a deliberate choice, not an oversight — documented in full as a new product decision, §8.6, including the schema/lifecycle of the local store (there is no new table), and the cross-device/reinstall limitations this choice accepts.
5. **§3.1's trigger condition, the options table (§3.5), §4.1's data-model notes, §8.2's rationale, the commit sequence (§9, commits 2, 4, 8), and the edge cases (§10) were all updated** to reflect the above — no section was left describing the old, inconsistent behaviour.

### What was preserved

- Every previously approved Phase 4 decision and scope item not directly touched by these two issues is unchanged: the six-option list, the reduced-completions data model (§5), the schedule editor folding into `habit-form.tsx` (§6), retroactive entry (§7), the "habits with measurable targets" terminology (§8.1), the one-combined-card rule (§8.5), and the overall commit ordering.
- The four actions still record different facts (§3.4's fact table) — only the suppression *duration* was unified, not the behavioural distinction Amendment 2 introduced.
- No new database table was introduced. The only synced table in this plan remains `lapse_reasons` (§4.3), unchanged in schema from the prior revision.

### Remaining product decisions requiring approval

- **§8.6 (new): Continue today/dismiss suppression stays device-local, with no synced "acknowledgement" table.** This is the one place this revision keeps an unsynced design; the rationale and documented limitations are in §8.6.
- The five decisions carried over from the prior revision (§8.1–§8.5) are unchanged and still stand for approval as a set: reduced completions restricted to habits with measurable targets; Continue today and Skip for today now recording different facts; the schedule editor folding into the existing habit-form modal; retroactive editing never setting `reduced`; and one combined recovery card rather than a stack.
- The three open questions in §12 (final copy, the schedule-editor deep-link, the `/3` reduced-target ratio) are unchanged and remain non-blocking.

### Confirmation

No source code, schema, migration, test, configuration, prompt, or other documentation file was modified to produce this revision. The only file changed is `docs/phase-4-plan.md`.

Waiting for approval before beginning Phase 4 implementation.
