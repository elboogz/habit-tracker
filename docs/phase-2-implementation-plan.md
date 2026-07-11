# Phase 2 Implementation Plan — Core Domain Model (Revision 2)

Planning document only. Revises the prior version of this plan to resolve eight specific issues raised in review. No source, schema, test, prompt, or configuration file has been changed to produce this document. A full changelog against the prior revision is at the end.

---

## 1. Schedule & Pause History Model

### Design (unchanged from Revision 1)

A single, append-only, effective-dated table models both schedule and pause state as one timeline per habit:

```ts
type ScheduleDays = 'daily' | number[]; // number[]: 0=Sunday..6=Saturday, matches Date.getDay()

type HabitSchedulePeriod = {
  id: string;
  habitId: string;
  effectiveFrom: string;   // local day key 'YYYY-MM-DD', inclusive — same format as HabitLog.date
  days: ScheduleDays;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
};
```

No `effectiveTo` field — the period governing date `D` is the one with the greatest `effectiveFrom <= D`. A new period is always an insert, never an edit of a prior row, which is what guarantees a schedule change cannot recalculate the meaning of past periods.

### Corrected local date handling (resolves issue 4)

The prior revision's resolver pseudocode used `new Date(date).getDay()` — passing a bare `'YYYY-MM-DD'` string directly to the `Date` constructor. This is a real bug, not a stylistic nit: JavaScript parses date-only ISO strings as **UTC midnight**, and `.getDay()` then reports the weekday in whatever local timezone the runtime is in. In any timezone behind UTC (e.g. any US zone), UTC-midnight-of-day-D converts to local-time-on-day-(D-1), so `.getDay()` silently returns the *wrong* weekday for roughly half the world's timezones. This is exactly the bug class the existing codebase already avoids elsewhere: `lib/habit-stats.ts`'s `addDays` and `components/habit-calendar.tsx`'s local `parseDayKey` both decompose the string and use the **local** `Date(year, month - 1, day)` constructor form, which is immune to this because it's never interpreted as UTC.

Proposed fix: one shared utility, added to `lib/domain/` alongside the schedule primitives (commit 4, §9) rather than as its own commit — it has no independent purpose yet, its only consumer is the scheduled-opportunity resolver:

```ts
// lib/domain/day-key.ts
export function parseDayKeyParts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

export function weekdayOf(key: string): number {
  const { year, month, day } = parseDayKeyParts(key);
  return new Date(year, month - 1, day).getDay(); // local constructor — never the string form
}
```

`isScheduledOpportunity` (below) calls `weekdayOf(date)`, never `new Date(date)`. `lib/habit-stats.ts`'s existing `dayKey`/`addDays` are relocated as-is into `lib/domain/` in commit 2 (they already use the safe pattern) and become the canonical home this new utility sits beside — no third reimplementation is introduced. `components/habit-calendar.tsx`'s own local `parseDayKey` already independently uses the correct pattern for its own (unrelated, display-grid) purpose and is not touched — consolidating it into the shared utility is a reasonable future cleanup but isn't required to fix the bug at hand, and touching a screen-adjacent component is out of Phase 2's scope.

**Test requirement**: `weekdayOf` must be verified to be timezone-independent, not merely correct on the machine that wrote it. Proposed test strategy: assert `weekdayOf` against a small table of reference `(day key, expected weekday)` pairs computed independently of the implementation, and run that same assertion set with the test process's `TZ` environment variable forced to at least three different values spanning positive and negative UTC offsets (e.g. `UTC`, `America/Los_Angeles`, `Pacific/Kiritimati`) to prove the result never shifts. This directly targets the failure mode the naive `new Date(string)` form would have exhibited.

### Habit start floor (resolves issue 5)

`isScheduledOpportunity` gains a hard floor: **no date strictly before a habit's effective local creation date (the local day key of `habit.createdAt`) is ever a Scheduled Opportunity, a Missed Scheduled Opportunity, or part of any Lapse or Recoverable Lapse Opportunity — regardless of what any schedule period says.** This applies even in the degenerate case of a schedule period whose `effectiveFrom` predates the habit's creation (which shouldn't occur through normal use, but the floor makes the rule correct regardless of how a period got there):

```ts
function isScheduledOpportunity(periods: HabitSchedulePeriod[], habit: Habit, date: string): boolean {
  if (date < localDayKeyOf(habit.createdAt)) return false;
  const { days, paused } = scheduleForDate(periods, habit.id, date);
  if (paused) return false;
  if (days === 'daily') return true;
  return days.includes(weekdayOf(date));
}
```

This also means every Consistency/Momentum window naturally excludes pre-creation dates without any special-casing in those functions — they only ever iterate real Scheduled Opportunities, which already start at creation by construction.

### Deterministic ordering tie-breaker (resolves issue 6)

`scheduleForDate`'s "pick the greatest `effectiveFrom`, ties broken by `createdAt`" rule was not fully deterministic — two periods can in principle share both an identical `effectiveFrom` (e.g. both backdated to the same day) and an identical `createdAt` (clock-resolution collision, or two devices creating a period offline before syncing). Final tie-breaker, applied only in that residual case: **prefer the greater `id` by plain lexicographic string comparison.** IDs are client-generated UUIDs (`Crypto.randomUUID()`); lexicographic comparison carries no semantic meaning, which is exactly the point — it only needs to be stable and deterministic across repeated evaluations, not meaningful.

```ts
function scheduleForDate(periods: HabitSchedulePeriod[], habitId: string, date: string): { days: ScheduleDays; paused: boolean } {
  const candidates = periods.filter(p => p.habitId === habitId && p.effectiveFrom <= date);
  if (candidates.length === 0) return { days: 'daily', paused: false };
  const latest = candidates.reduce((a, b) => {
    if (b.effectiveFrom !== a.effectiveFrom) return b.effectiveFrom > a.effectiveFrom ? b : a;
    if (b.createdAt !== a.createdAt) return b.createdAt > a.createdAt ? b : a;
    return b.id > a.id ? b : a;
  });
  return { days: latest.days, paused: latest.paused };
}
```

### Migration, reversibility, timezone behavior, and scope note

Unchanged from Revision 1: no backfill required (the resolver's zero-periods default reproduces current behavior exactly), migration is trivially reversible (additive table, nothing existing altered), `effectiveFrom` uses local day keys consistent with the rest of the app, and Phase 2 adds no schedule-editing UI — the table will hold zero rows immediately after Phase 2 ships.

---

## 2. Shared-Domain Architecture (React Native + 2 Deno Edge Functions)

### Design (unchanged core proposal)

Given the Edge Functions are hand-pasted into the Supabase Dashboard with no CLI deploy and no build step, a live shared import isn't possible. `lib/domain/` remains the single hand-edited, dependency-free source of truth; a generation script inlines it into both Edge Function files between marker comments, and the developer's remaining manual step is exactly today's — paste the regenerated file into the Dashboard.

### Strengthened guarantees (resolves issue 7)

**Deterministic generated output.** The script performs a pure text splice: read `lib/domain/*.ts` verbatim, insert it between `// BEGIN GENERATED DOMAIN` / `// END GENERATED DOMAIN` markers in each Edge Function file. No timestamps, no non-deterministic ordering, no environment-dependent output — running the script twice against the same domain source produces byte-identical files. This determinism is what makes the verification step below possible at all.

**Verification command.** A Jest test (`scripts/build-edge-functions.test.ts`, part of the same test suite as everything else in this phase) re-runs the generator in-memory and diffs its output against the actual checked-in content of both `supabase/functions/*/index.ts` files, failing if they differ. This catches two failure modes: a developer hand-edited the generated block directly (drift from the source of truth), or a developer changed `lib/domain/` and forgot to regenerate. There's no CI in this project today, so this is a locally-runnable safeguard (`npm test` or `npm run verify:edge-functions`) rather than an enforced gate — noted as a real limitation, not glossed over.

**Import safeguards.** The generator itself statically scans `lib/domain/*.ts` for disallowed import specifiers before splicing — a simple denylist check (`expo-`, `react-native`, `@supabase/`, `Deno.`) that throws and refuses to generate if any are found. This is enforced every time the script runs, not left to code-review discipline alone, so a dependency that would break one runtime or the other can't silently enter the shared layer.

Together these three guarantees are what let both Edge Functions and the RN app execute identical business rules: the source is single, the splice is provably faithful, and the source is provably free of runtime-specific dependencies.

---

## 3. Definitions and Threshold Table

All definitions operate only on dates `<= today`, and — per §1 — never on dates before a habit's creation. All thresholds live in exactly one file, `lib/domain/config.ts`.

### Scheduled Opportunity, Completion, Reduced Completion, Missed Scheduled Opportunity
Unchanged from Revision 1. A Scheduled Opportunity is `(habitId, date)` where `isScheduledOpportunity` (§1) is true. A Completion meets the habit's target/any-count rule. A Reduced Completion is a Completion explicitly flagged `reduced: true`, only creatable when the habit has a configured reduced target. A miss is a Scheduled Opportunity for `date < today` with no qualifying Completion — today is never classified as missed.

### Lapse
A maximal run of consecutive Scheduled Opportunities (consecutive **within the habit's Scheduled Opportunity sequence**, silently skipping any non-scheduled or paused calendar days, which are simply absent from that sequence) that are all missed, opening at the first miss following a Completion (or the habit's creation, per §1's floor, if no prior Completion exists).

This is a **narrative/duration concept** — "you had a 3-day lapse" — used for messaging (Phase 4) and Recovery Time (below). It is deliberately a different unit of analysis from Recoverable Lapse Opportunity, defined next; the two are related but not interchangeable, and conflating them was the source of the ambiguity this revision resolves.

### Recoverable Lapse Opportunity, Recovery Event, and Recovery Rate — resolved definition (resolves issue 3)

**The precise behavior chosen**: Recovery Rate measures **recovery on the first available (immediately following) Scheduled Opportunity** — not eventual recovery within an unbounded or arbitrarily-windowed lapse. This reading follows the spec's own wording most directly ("a lapse opportunity is any occasion on which the user missed one or more consecutive scheduled opportunities and then had **a** subsequent scheduled opportunity on which recovery was possible" — singular, the immediate next one) and is the only reading of the three considered that yields a well-defined, terminating computation without inventing an un-specified "give up" timeout:

- *Eventual recovery within an unbounded window* was rejected because a Recoverable Lapse Opportunity would then only ever resolve via success — an indefinitely ongoing miss streak would simply stay pending forever, and every resolved instance would trivially be a "recovery," making the rate degenerate to 100% once any 3 samples exist. There would be no way for a genuine "did not come back" outcome to ever register.
- *Eventual recovery within an arbitrary fixed window* (e.g. "within 14 days") was rejected because the spec specifies no such window, and inventing one would be a new, unrequested product concept.

**Formal definition**: let `o_1 < o_2 < ... < o_n <= today` be a habit's Scheduled Opportunity sequence. For every adjacent pair `(o_{i-1}, o_i)` where `completed(o_{i-1}) = false`, that pair is one **Recoverable Lapse Opportunity instance**, resolved as of `o_i` (always true by construction, since `o_i <= today`):
- **Recovered** (numerator +1, denominator +1) if `completed(o_i) = true`. This same event is, simultaneously, the **Recovery Event** — the two are the same detection, used in two contexts (the Phase 3 celebration moment, and this statistic's numerator).
- **Not recovered** (denominator +1 only) if `completed(o_i) = false` — and in this case, the miss-run continues, so the pair `(o_i, o_{i+1})` becomes its *own*, separately-resolving Recoverable Lapse Opportunity once `o_{i+1}` occurs.

**Direct, intentional consequence**: one long, unbroken miss streak produces *multiple* resolved "not recovered" instances — one for each additional day missed after the first — not a single verdict for the whole streak. This is deliberate, not an oversight (see the worked "several misses with no return" example below), and it's why the spec's own shame-avoidance rules (the 3-sample minimum and the low-rate display threshold) are load-bearing: they are what keeps a long lapse from surfacing as a crashing, punitive percentage, rather than the counting rule itself softening it.

```
Recovery Rate = (Recoverable Lapse Opportunity instances where recovered = true)
              / (total resolved Recoverable Lapse Opportunity instances)
```

Display rules (approved decision, unchanged): fewer than 3 resolved instances → never a percentage; show Total Completions, Recovery Time where available, or "Not enough recovery history yet." At or above 3, show the percentage unless it's below the low-rate threshold (proposed `0.3`), in which case still prefer Recovery Time/Total Completions, per the spec's explicit shame-avoidance rule.

### Recovery Time — a deliberately different unit of analysis

Recovery Time is measured at the **Lapse** level (the whole maximal miss-run), not the pairwise Recoverable-Lapse-Opportunity level: for a Lapse that eventually closes via a Completion, Recovery Time = calendar days from the Lapse's first miss to that Completion's date. Average Recovery Time = the mean across all lifetime closed Lapses.

This is intentionally a coarser grain than Recovery Rate. Reconciling them into one unit would either make Recovery Rate meaningless (pairwise recovery time is always exactly "the gap to the next scheduled opportunity," which barely varies) or make Recovery Rate immeasurable for long lapses (per the rejected "eventual recovery" reading above). Keeping them at different grains lets Recovery Rate answer "how often do you bounce back immediately" while Recovery Time answers "when a real lapse happens, how long does it typically take to resolve" — two different, both spec-named, metrics.

### Recovery Rate time horizon: lifetime, rolling, or both (resolves issue 8)

Revision 1 assumed lifetime-only. Reconsidered:

| Horizon | Behavior | Cost |
|---|---|---|
| **Lifetime** | Slow-moving, stable, matches Total Completions' cumulative framing. Risk: a user who's improved dramatically in the last few months still carries years-old struggles in the same number, which sits awkwardly next to the spec's goal of "recognize genuine progress." |
| **Rolling** (proposed: trailing 10 resolved Recoverable Lapse Opportunities, not a calendar-day window — chosen to stay in the domain's own units, since a calendar-day window behaves very differently for a daily habit vs. a Mon/Wed/Fri habit) | Responsive to recent behavior, aligns with Momentum State's own recency framing. Risk: noisier, and for infrequent habits may rarely accumulate the 3-sample minimum, so "not enough data" could show up *more* often than under lifetime. |
| **Both** | See below. |

**Engineering cost of computing both**: negligible, and this plan proposes doing so. Every quantity here is derived-on-read from the same in-memory pass over a habit's logs and schedule periods (§4) — there is no new data fetch, no new table, and no meaningfully different algorithm. Computing "both" is exactly one extra bounded slice-and-reduce over already-loaded Recoverable Lapse Opportunity instances (take the last 10 instead of all of them), which at this app's realistic scale (a personal habit tracker, per `CLAUDE.md`) is sub-millisecond. Storage implications: none for either — both stay derived-on-read, consistent with §4's existing "no new tables beyond `habit_schedule_periods`" decision.

Proposed: the domain layer returns both (`{ lifetime: RecoveryRateResult; rolling: RecoveryRateResult }`), computed with the *same* `RECOVERY_CONFIG` thresholds applied independently to each (no separate threshold set per horizon — reusing the same constants avoids doubling the config surface for a distinction the spec doesn't ask for). **Which one Phase 3 actually presents (one, the other, or both) is explicitly left open, per the instruction not to make that presentation call here.**

### Momentum
Unchanged in spirit from Revision 1: an internal (never directly displayed) signed trend signal — the difference between the Completion rate over the most recent evidence window of Scheduled Opportunities and the equally-sized window before it, clamped to `[-1, 1]`. It is an input to candidate-state computation only (below), not a separately confirmed or displayed value.

### Momentum State — candidate/confirmed separation and real hysteresis (resolves issue 2)

Revision 1's claim that "window size alone provides hysteresis" was wrong, and this revision retracts it. A rolling multi-opportunity window can still cross its own threshold the instant one new opportunity is added — e.g. a `steady` habit sitting at exactly 4-of-5 (80%) drops to 3-of-5 (60%) the moment one more opportunity is missed, which is a single-opportunity flip in a window-based scheme, not multi-opportunity evidence. Window size controls how much history a *snapshot* considers; it does not, by itself, prevent the classification from changing every time a new data point arrives.

**Two explicitly separate layers:**

1. **Candidate state** — `candidateStateAt(habit, periods, logs, date)`: the raw classification from the threshold table (unchanged from Revision 1, reproduced below), recomputed fresh at any given date using only opportunities `<= date`. This has no memory of what came before it; it can change from one opportunity to the next.

2. **Confirmed state** — the value actually surfaced to the rest of the app. A transition from one confirmed state to another only takes effect once the candidate state has been the same *new* value for `TRANSITION_CONFIRMATION_OPPORTUNITIES` (proposed: 3) **consecutive** Scheduled Opportunities. A single anomalous opportunity can start a pending transition but cannot complete one.

**Computation — a single deterministic forward scan, no persisted state required:**

```ts
function confirmedStateAt(habit: Habit, periods: HabitSchedulePeriod[], logs: HabitLog[], today: string): MomentumStateKey {
  const opportunities = scheduledOpportunitiesUpTo(habit, periods, today); // ascending, oldest first
  let confirmed: MomentumStateKey = 'insufficient_data';
  let pendingState: MomentumStateKey | null = null;
  let pendingCount = 0;

  for (const date of opportunities) {
    const candidate = candidateStateAt(habit, periods, logs, date);
    if (candidate === confirmed) {
      pendingState = null;
      pendingCount = 0;
    } else if (candidate === pendingState) {
      pendingCount += 1;
      if (pendingCount >= MOMENTUM_CONFIG.transitionConfirmationOpportunities) {
        confirmed = candidate;
        pendingState = null;
        pendingCount = 0;
      }
    } else {
      pendingState = candidate;
      pendingCount = 1;
    }
  }
  return confirmed;
}
```

This is **entirely derived and deterministic**: it is a pure fold over the habit's Scheduled Opportunity history (schedule periods + logs only), recomputed fully from scratch on every call, with no cross-call memory, no cache, and no new table. The same inputs always produce the same output. It directly prevents a single anomalous completion or miss from changing a confirmed state: such an opportunity can only ever start (`pendingCount = 1`) or reset (fall back to matching `confirmed`) a pending transition, never complete one by itself.

**Trade-off, surfaced explicitly rather than adopted silently**: this scan is `O(n)` in the habit's total lifetime Scheduled Opportunity count, recomputed on every read, rather than `O(1)` against a cached "last confirmed state." At this app's actual scale (a personal habit tracker; a multi-year daily habit is on the order of ~1,000 opportunities, a sub-millisecond JS loop) this is not a real performance concern today, and no stored/cached confirmed-state value is proposed. If usage patterns ever made this cost material (e.g. computing momentum for many habits on every render at a scale this app doesn't currently have), the natural optimization would be to cache the last confirmed state plus the date it was last confirmed and only rescan forward from there — which **would** be a form of stored state, reintroducing exactly the trade-off against the derived-on-read architecture that this plan is not proposing to make now. Flagged here as a known future option, not adopted, per the instruction not to optimize for hypothetical future needs.

**Uniform confirmation count vs. per-state candidate windows**: the approved decision states both "most transitions require evidence across at least three scheduled opportunities" and "stronger states such as thriving require a longer evidence window than recovering." This plan satisfies both with two different mechanisms: the *candidate* windows vary by state (thriving's candidate window is 8 opportunities, recovering's is 3 — see the table below), while the *confirmation* count is uniform at 3 across all states. This is a specific design choice, not the only possible reading — one could instead argue stronger states should also require a longer *confirmation* streak, not just a longer candidate-computation window. Flagged as an open question in the closing summary rather than silently treated as settled.

**Evaluation order for candidate state** (first match wins, unchanged from Revision 1): `insufficient_data` → `recovering` → `quiet` → best of `{thriving, steady, building}` → `rebuilding` fallback.

**Proposed threshold table** (first proposal, not yet empirically tuned):

| State | Candidate evidence window (opportunities) | Entry condition |
|---|---|---|
| `insufficient_data` | — | fewer than 3 lifetime scheduled opportunities |
| `building` | 3 | completion rate ≥ 60% over the window, improving vs. the prior 3 |
| `steady` | 5 | completion rate ≥ 80% over the window, no open lapse |
| `thriving` | 8 | completion rate ≥ 90% over the window, no lapse anywhere in it |
| `recovering` | 3 | a Recovery Event within the window, closing a lapse of ≤ 2 misses |
| `rebuilding` | 5 | resuming completions after a lapse of ≥ 3 misses, window not yet at `steady`'s bar |
| `quiet` | 3 | ≥ 2 of the last 3 scheduled opportunities missed, lapse currently open |

### `lib/domain/config.ts` (revised shape)

```ts
export const RECOVERY_CONFIG = {
  minResolvedLapsesForPercentage: 3,        // approved
  lowRecoveryRateShameThreshold: 0.3,       // proposed — confirm
  rollingWindowOpportunities: 10,           // proposed — confirm
} as const;

export const MOMENTUM_CONFIG = {
  transitionConfirmationOpportunities: 3,   // proposed — confirm (uniform across states, see above)
  insufficientData: { minScheduledOpportunities: 3 },
  thriving:   { window: 8, minCompletionRate: 0.9 },
  steady:     { window: 5, minCompletionRate: 0.8 },
  building:   { window: 3, minCompletionRate: 0.6, requireImproving: true },
  recovering: { window: 3, maxPrecedingLapseLength: 2 },
  rebuilding: { window: 5, minPrecedingLapseLength: 3 },
  quiet:      { window: 3, minMissedFraction: 2 / 3 },
} as const;
```

### Worked date-by-date examples (resolves issue 3)

All examples use a daily habit unless noted, with `today = 2026-07-10` except where a longer arc requires a later "today."

**A — miss then complete**

| Date | Scheduled | Completed | Lapse | Recoverable-Lapse-Opportunity | Recovery Event | Rate numerator | Rate denominator |
|---|---|---|---|---|---|---|---|
| 07-01 | yes | yes | — | — | — | — | — |
| 07-02 | yes | no | opens | pending (awaits 07-03) | — | — | — |
| 07-03 | yes | yes | closes | (07-02→07-03): recovered | **yes**, on 07-03 | +1 | +1 |

**B — miss, miss, then complete**

| Date | Scheduled | Completed | Lapse | Recoverable-Lapse-Opportunity | Recovery Event | Rate num. | Rate denom. |
|---|---|---|---|---|---|---|---|
| 07-01 | yes | yes | — | — | — | — | — |
| 07-02 | yes | no | opens | pending (awaits 07-03) | — | — | — |
| 07-03 | yes | no | continues | (07-02→07-03): **not** recovered | — | +0 | +1 |
| 07-04 | yes | yes | closes | (07-03→07-04): recovered | **yes**, on 07-04 | +1 | +1 |

Recovery Time for this one Lapse (07-02 → 07-04) = 2 calendar days. Local Recovery Rate contribution for this episode: 1 recovered / 2 resolved = 50%.

**C — several misses with no return** (today = 2026-07-10, no completion since 07-01)

| Date | Scheduled | Completed | Recoverable-Lapse-Opportunity | Rate num. | Rate denom. |
|---|---|---|---|---|---|
| 07-01 | yes | yes | — | — | — |
| 07-02 | yes | no | (07-01 was completed; 07-02 opens the lapse) | — | — |
| 07-03 | yes | no | (07-02→07-03): not recovered | +0 | +1 |
| 07-04 | yes | no | (07-03→07-04): not recovered | +0 | +1 |
| 07-05 | yes | no | (07-04→07-05): not recovered | +0 | +1 |
| 07-06 | yes | no | (07-05→07-06): not recovered | +0 | +1 |
| 07-07 | yes | no | (07-06→07-07): not recovered | +0 | +1 |
| 07-08 | yes | no | (07-07→07-08): not recovered | +0 | +1 |
| 07-09 | yes | no | (07-08→07-09): not recovered | +0 | +1 |
| 07-10 (today) | yes | not yet decided | (07-09→07-10): **open**, not yet resolved | — | — |

Seven resolved "not recovered" instances so far, none recovered; the Lapse itself is still open (no Recovery Time yet — it hasn't closed). This is the direct illustration of why the counting rule alone is not what prevents this from feeling punitive: it's the ≥3-sample-and-shame-threshold display rules (§3) that keep this from surfacing as a stark percentage.

**D — miss, pause, resume, then complete**

| Date | Period in effect | Scheduled | Completed | Notes |
|---|---|---|---|---|
| 07-01 | daily | yes | yes | — |
| 07-02 | daily | yes | no | Lapse opens |
| 07-03 | **paused** (new period, effectiveFrom 07-03) | no | n/a | not a Scheduled Opportunity — absent from the sequence entirely |
| 07-04, 07-05 | paused | no | n/a | same |
| 07-06 | resumed (new period, effectiveFrom 07-06, daily) | yes | yes | next entry in the Scheduled Opportunity sequence after 07-02 |

Recoverable-Lapse-Opportunity pair is `(07-02, 07-06)` — the pause days are simply not part of the sequence, so the "next" opportunity after the 07-02 miss is 07-06, regardless of the 3-day calendar gap. `completed(07-06) = true` → **recovered**, Recovery Event fires on 07-06, +1/+1.

**E — non-scheduled days between completions** (Mon/Wed/Fri schedule, no misses)

| Date | Weekday | Scheduled | Completed |
|---|---|---|---|
| 07-06 (Mon) | Mon | yes | yes |
| 07-07 (Tue) | Tue | **no** | n/a |
| 07-08 (Wed) | Wed | yes | yes |
| 07-09 (Thu) | Thu | **no** | n/a |
| 07-10 (Fri, today) | Fri | yes | yes |

Scheduled Opportunity sequence = `[07-06, 07-08, 07-10]`; Tuesday and Thursday never appear in it at all. No Lapse ever opens; Recovery Rate has zero contributions either way (correctly shown as "not enough recovery history yet," not 0%).

**F — retroactive completion**

Initial state (today = 07-05, no retroactive edit yet): 07-01 completed, 07-02 missed, 07-03 completed. Pair `(07-02, 07-03)`: `completed(07-03) = true` → recovered, Recovery Event on 07-03, +1/+1.

User later retroactively logs a completion for 07-02. On the next recomputation (everything is derived fresh, §5 below): `completed(07-02)` is now `true`. There is no longer a miss at 07-02, so the pair `(07-02, 07-03)` no longer exists as a Recoverable Lapse Opportunity at all — it disappears from the Recovery Rate computation entirely (denominator and numerator both revert by 1 relative to before), and 07-03 is no longer a Recovery Event, since nothing was missed immediately before it. This matches the spec's explicit exclusion ("retroactive entries that did not miss a scheduled opportunity" are not a Recovery Event) and is a direct consequence of §5's "nothing is cached, everything is recomputed" design — not a special case.

---

## 4. Data Storage Decisions — Stored Facts vs. Derived Metrics

Unchanged from Revision 1. Phase 2's only new table is `habit_schedule_periods` (a stored fact — user-configured, cannot be derived). Recovery Events, Recoverable Lapse Opportunities, Recovery Rate (both horizons, per §3), Recovery Time, Momentum, and Momentum State (candidate and confirmed) are all derived on read, with no new table. Lapse Reason's type is defined in the domain layer per the spec's "shared domain concepts" list, but its table and writer UI are deferred to Phase 4. Momentum State *history* (for Phase 8 analytics) is deliberately out of Phase 2 scope, for the same reason given in Revision 1: Phase 3's UI only ever needs the current state, which stays cheap to derive live; a trend-over-time view is an analytics concern with its own snapshot-table design, not a domain-layer one.

---

## 5. Recovery/Lapse Detection Under Hard-Deleted `habit_logs`

Unchanged from Revision 1, and directly exercised by the worked examples in §3 (especially example F). The central design decision remains: nothing about a miss, Lapse, or Recovery Event is ever stored as its own record — every one of §3's concepts is a pure function evaluated fresh over whatever `habit_logs` and `habit_schedule_periods` currently exist, which is exactly what makes same-day toggling and hard deletes tractable (today is never judged as missed, so mid-day toggling never matters; a retroactive edit simply changes the next recomputation, with nothing to reconcile against).

What this guarantees and does not guarantee is unchanged from Revision 1: any two evaluations of the same inputs at the same time produce identical results, and history edits correctly propagate — but there is no way to reconstruct what a past Momentum State computation "would have shown" before a subsequent edit, and no audit trail of same-day log/unlog toggling, since neither is ever persisted.

---

## 6. Local Persistence (AsyncStorage) Migration — corrected design (resolves issue 1)

### What was wrong with Revision 1

The actual hydration code, inspected directly from `lib/habit-store.tsx`, is:

```ts
const parsed = JSON.parse(scoped);
dispatch({
  type: 'hydrate',
  state: { ...initialState, ...parsed, challenges: migrateChallenges(parsed.challenges) },
});
```

and the actual persistence code is:

```ts
AsyncStorage.setItem(scopedKey(userId), JSON.stringify(state));
```

Today's persisted value is a **bare `HabitState`-shaped object** — `habits`, `logs`, `challenges`, `hasOnboarded`, `notifications`, `soundEnabled` all sit at the top level, with no wrapper of any kind. Revision 1 proposed persisting `{ schemaVersion: number; state: HabitState }` — nesting the real data under a `state` key. This breaks backward compatibility precisely because of the line above: an app that doesn't know about the envelope does `{ ...initialState, ...parsed }`, where `parsed` would now be `{ schemaVersion, state }` — its meaningful fields (`habits`, `logs`, etc.) are not at the top level of `parsed` at all, so they would **not** override `initialState`'s empty defaults. The resulting in-memory state would have empty habits/logs/challenges (silently reverting to a fresh install), and the very next write (`JSON.stringify(state)`, unconditionally triggered by any mutation) would persist that emptied state back to storage — a real, silent data-loss bug for any old app version that ever reads new-envelope data. Nesting is the specific defect; it is corrected, not merely reworded, below.

### Corrected design: no envelope, no version number — per-field defaulting

The existing codebase already has an established, working pattern for exactly this situation: `migrateChallenges` (adding `habitIds` where only a legacy `habitId` existed) and `backfillTimestamps` (adding `updatedAt` where absent) both work by **keeping new/changed fields at the same top level as everything else**, defaulting per-field when absent, with no version marker anywhere. Phase 2 follows the same convention rather than introducing a new envelope/version concept — this is a smaller, better-justified change (matching an existing pattern already proven correct in this codebase) than inventing new persistence-layer machinery:

```ts
// lib/domain/schedule.ts (or co-located with the other migration helpers in habit-store.tsx)
function migrateSchedulePeriods(periods: HabitSchedulePeriod[] | undefined): HabitSchedulePeriod[] {
  return periods ?? [];
}
```

Applied at both existing call sites that already run `migrateChallenges` today (the scoped-key hydration path and the legacy pre-auth migration path):

```ts
dispatch({
  type: 'hydrate',
  state: {
    ...initialState,
    ...parsed,
    challenges: migrateChallenges(parsed.challenges),
    schedulePeriods: migrateSchedulePeriods(parsed.schedulePeriods),
  },
});
```

`HabitState` gains `schedulePeriods: HabitSchedulePeriod[]` as a normal field, exactly like `challenges`. No `schemaVersion` field is introduced anywhere — the presence, absence, or shape of `schedulePeriods` itself is the only signal needed, identical in spirit to how `habitIds` vs. legacy `habitId` is handled today.

### Upgrade, downgrade, and cross-version behavior (corrected)

- **New app reads pre-Phase-2 blob** (no `schedulePeriods` key): `migrateSchedulePeriods(undefined)` returns `[]`, semantically identical to "always been daily" (§1's resolver default) — a pure no-op in behavior, additive in shape only.
- **Old app reads a Phase-2 blob** (has `schedulePeriods`, populated or not): old code's `{ ...initialState, ...parsed, challenges: migrateChallenges(parsed.challenges) }` correctly populates `habits`/`logs`/`challenges`/`hasOnboarded`/`notifications`/`soundEnabled` from `parsed` exactly as it does today, because those fields are still all at the same top level `parsed` always had. `schedulePeriods` rides along as an extra, unknown-to-old-code key — inert, never read, but preserved through the reducer's `{ ...state, field: value }` update pattern (every existing case already spreads forward rather than reconstructing state from a fixed field list), so it survives being written back by old code untouched. No data loss, no silent reversion, unlike the nested-envelope design.
- **Rollback**: free, by construction — an app rollback to a pre-Phase-2 build is exactly the "old app reads new blob" case above.
- **Partial migration recovery**: there is no longer a distinct "migration step" to interrupt. `migrateSchedulePeriods` runs fresh on every hydration and is idempotent (defaulting only when absent, passing an existing array through unchanged) — there is nothing to leave "partially done."
- **Local succeeds / remote fails, remote succeeds / local fails**: unchanged from Revision 1's reasoning — nothing writes a schedule period until Phase 4 ships an editing UI, so a gap between "local code knows the field exists" and "the Postgres table exists" is invisible to users in Phase 2 itself. If a schedule-period write is ever attempted before the table exists, the existing outbox behavior (`pushPendingChanges` stops at the first failure, retries next trigger) applies unchanged — a pre-existing FIFO-outbox limitation, not new to Phase 2. Mitigation: confirm the Postgres migration has run before any build containing schedule-editing UI ships.
- **Cross-device version skew**: unchanged from Revision 1 — an old-build device simply never queries `habit_schedule_periods` and continues treating every habit as daily; this is accepted, expected behavior for a rolling upgrade.

### Tests required (added per issue 1)

| Test | Verifies |
|---|---|
| `migrateSchedulePeriods(undefined)` returns `[]` | Additive default is correct |
| `migrateSchedulePeriods([...existing])` returns the same array unchanged | Pass-through is correct, no accidental mutation |
| Hydrating a pre-Phase-2-shaped blob (no `schedulePeriods` key) produces a state with `schedulePeriods: []` and all other fields intact | The upgrade path |
| Hydrating a Phase-2-shaped blob with populated `schedulePeriods` preserves them exactly | No data loss on a normal read |
| **Simulating old code's merge logic** (`{ ...initialState, ...parsed, challenges: migrateChallenges(parsed.challenges) }`, with no knowledge of `schedulePeriods`) **against a Phase-2-shaped blob** asserts that `habits`/`logs`/`challenges`/`hasOnboarded`/`notifications`/`soundEnabled` are populated correctly from `parsed` (not reset to `initialState`'s empty defaults) | Directly tests the backward-compatibility property this revision restores — the specific case Revision 1 got wrong |
| Round-trip: construct a state with non-empty `schedulePeriods`, serialize, re-hydrate, assert deep equality | No information is lost across a normal write/read cycle |

---

## 7. Relocating Challenge-Failure Evaluation

Unchanged from Revision 1: moves the existing `useEffect` from `app/(tabs)/index.tsx` into `HabitStoreProvider`, preserving `challengeProgress`'s current `isFailed` semantics exactly (the tolerance redesign stays in Phase 7). `challengeProgress` is rerouted through the schedule-aware opportunity check, which — since every habit defaults to daily with zero periods (§1) — produces byte-for-byte identical output today, verified by re-asserting existing challenge fixtures before and after. This section is unaffected by the corrections above; the only change of substance elsewhere (dropping the `schemaVersion` envelope in §6) does not alter what gets threaded into `challengeProgress` here.

---

## 8. Test Framework and Fixtures — Behavioral Contract (resolves issue 3's fixture requirement)

### Framework
Unchanged from Revision 1: Jest with the `jest-expo` preset, proposed new dev dependencies `jest`, `jest-expo`, `@types/jest`, and a `"test": "jest"` script — described here for review, not added in this checkpoint.

### Fixture table — the behavioral contract

Every worked example from §3, plus the additional scenarios required, become deterministic fixtures with explicit expected outputs across all seven domain outputs. These fixtures are the contract: **future refactoring of the domain layer must preserve these exact outputs unless the product specification itself intentionally changes.**

| Fixture | Setup (abbreviated) | Scheduled Opportunities | Recovery Events | Recoverable Lapse Opportunities (resolved) | Recovery Rate | Recovery Time | Momentum State (confirmed) |
|---|---|---|---|---|---|---|---|
| `brand_new_insufficient_data` | Daily habit, created today, 0–2 opportunities elapsed | 0–2 | 0 | 0 resolved | not enough history | n/a | `insufficient_data` |
| `perfect_completion_history` | Daily habit, 15/15 days completed | 15 | 0 | 0 resolved | not enough history | n/a | `thriving` (candidate reaches thriving at opportunity 8; confirmed at opportunity 10 after 3 consecutive agreeing candidates) |
| `single_missed_then_recovery` | Example A (§3) | 3 | 1 (on day 3) | 1 resolved, 1 recovered | 100% (1/1, still below 3-sample minimum — shown as "not enough history," not 100%) | 1 day | depends on surrounding history; isolated case stays within `building`/`steady` candidate range, no transition confirmed from one event alone |
| `multiple_misses_then_recovery` | Example B (§3) | 4 | 1 (on day 4) | 2 resolved, 1 recovered | 50% (below 3-sample minimum — "not enough history") | 2 days | as above, insufficient events to confirm any transition alone |
| `several_misses_no_return` | Example C (§3), today = 07-10 | 9 (through today) | 0 | 7 resolved, 0 recovered | 0% — but below 3-sample floor does not apply here (7 ≥ 3); however 0% is also below the low-rate threshold (0.3) → **display falls back to Recovery Time/Total Completions, not a 0% figure** | n/a (Lapse still open, unresolved) | trending toward `quiet` once 3 consecutive missed opportunities confirm it |
| `paused_then_resumed_recovery` | Example D (§3) | 07-01, 07-02, 07-06 (07-03–05 excluded, paused) | 1 (on 07-06) | 1 resolved, 1 recovered | below 3-sample minimum | 4 calendar days (07-02 to 07-06) | n/a for this isolated snippet |
| `non_scheduled_days_between_completions` | Example E (§3), Mon/Wed/Fri | 3 (07-06, 07-08, 07-10) | 0 | 0 resolved | not enough history | n/a | insufficient events to leave `insufficient_data` yet at only 3 opportunities |
| `retroactive_completion` | Example F (§3), before and after the backfill | 3 → 3 | 1 → 0 | 1 resolved/1 recovered → 0 resolved | 100% (below sample floor either way) → not enough history | 1 day → n/a | unaffected at this scale |
| `sparse_recovery_history_below_threshold` | 2 resolved instances lifetime, 1 recovered / 1 not | n/a | 1 | 2 resolved, 1 recovered | 50%, but **2 < 3 → percentage suppressed**, shows Total Completions/Recovery Time instead | 1 recorded value (from the recovered instance) | n/a |
| `recovery_rate_display_thresholds` | 4 resolved lifetime, 1 recovered (25%) | n/a | 1 | 4 resolved, 1 recovered | **25% is ≥ 3 samples but < 0.3 → percentage still suppressed**, Recovery Time/Total Completions shown | present | n/a |
| `recovery_rate_display_thresholds_shown` | 3 resolved lifetime, 2 recovered (66.7%) | n/a | 2 | 3 resolved, 2 recovered | **≥ 3 samples and ≥ 0.3 → 67% is displayed** | present | n/a |
| `momentum_hysteresis_single_anomaly` | Habit confirmed `steady`, one isolated miss breaking an otherwise-consistent pattern, then reverts | varies | 1 (the bounce-back) | 1 resolved, 1 recovered | n/a to this check | n/a | **confirmed state does not change** — candidate may dip for 1 opportunity but never reaches the 3-in-a-row confirmation threshold |
| `momentum_hysteresis_confirmed_transition` | Same starting point, but the new (lower) pattern persists for 3+ consecutive opportunities | varies | n/a | n/a | n/a | n/a | confirmed state **does** change, specifically on the 3rd consecutive opportunity where the candidate agrees on the new state, not the 1st |
| `momentum_hysteresis_flapping` | Candidate alternates between two states every single opportunity, never 3 in a row | varies | n/a | n/a | n/a | n/a | confirmed state **never changes** from its initial value throughout |
| `schedule_change_mid_history` | Daily for 2 weeks, then Mon/Wed/Fri from a later `effectiveFrom`; pre-change weekend misses exist | pre-change: 14 (daily); post-change: Mon/Wed/Fri only | depends on log pattern | pre-change weekend misses remain misses forever, unaffected by the later schedule change (direct test of §1's "past periods never recalculated" guarantee) | — | — | — |
| `long_term_improving_trajectory` | ~4 weeks poor consistency, then gradually improving over following weeks | grows over time | multiple | growing set | improves gradually, each shown value gated by the same display rules above | shortens over time | confirmed sequence: `insufficient_data` → `quiet`/`rebuilding` → `building` → `steady` → `thriving`, each transition only after its own 3-in-a-row confirmation, never earlier |
| `long_term_declining_trajectory` | Starts `steady`/`thriving`, then a sustained multi-week decline | — | — | growing set of unresolved/not-recovered instances | degrades gradually, gated by display rules | — | confirmed sequence: `steady`/`thriving` → `building` → `quiet`/`rebuilding`, again only after sustained (3+ opportunity) evidence, never on the first bad day |

### Weekday/day-key tests
Covered in §1: `weekdayOf` verified against known reference dates under multiple forced `TZ` values.

### Migration tests
Covered in §6.

---

## 9. Phase 2 Commit Sequence (revised)

The same nine-commit skeleton from Revision 1 is preserved; descriptions below reflect the corrections in this revision.

1. **Add the test framework (Jest + `jest-expo`), no domain code.** Unchanged.

2. **Introduce `lib/domain/` by relocating the existing pure functions out of `lib/habit-stats.ts`** (including `dayKey`/`addDays`, which already use the safe local-constructor pattern), with `lib/habit-stats.ts` becoming a re-export barrel. Zero behavior change; first characterization tests written here. Unchanged.

3. **Add `lib/domain/config.ts`** with the revised Recovery/Momentum constants from §3 (including the new `rollingWindowOpportunities` and `transitionConfirmationOpportunities`), consumed by nothing yet. Unchanged in purpose, updated contents.

4. **Add `HabitSchedulePeriod`, `scheduleForDate`/`isScheduledOpportunity`, and the shared `parseDayKeyParts`/`weekdayOf` utility** (§1), including the habit-creation floor and the `id`-based final tie-breaker, fully unit-tested including the multi-timezone weekday tests. Not wired into the reducer/store/UI yet. Expanded from Revision 1 to include the corrected date handling and tie-breaker.

5. **Add the `habit_schedule_periods` Postgres table (additive) and wire `schedulePeriods` into local `HabitState`** using the corrected per-field-default migration (§6) — no envelope, no version number — plus the sync layer's row mapping and `mergeRemote` case, plus the full backward-compatibility test suite from §6. Substantively corrected from Revision 1.

6. **Relocate challenge-failure evaluation** from the Today screen into `HabitStoreProvider`, preserving exact current semantics, verified via unchanged fixtures. Unchanged.

7. **Add Recovery Event / Lapse / Recoverable-Lapse-Opportunity / Recovery Rate (both lifetime and rolling horizons) / Recovery Time**, consuming the schedule resolver (commit 4) and config (commit 3), with the full worked-example fixture suite from §8 (§3's A–F plus the sparse/threshold cases) as executable tests. Expanded from Revision 1 to include the resolved pairwise definition and dual-horizon computation.

8. **Add Momentum / Momentum State with the candidate/confirmed hysteresis split**, consuming Recovery Events (commit 7), with the full transition-stability fixture suite from §8 (single-anomaly, confirmed-transition, flapping, plus the long-term improving/declining trajectories). Substantively corrected from Revision 1.

9. **Add the Edge Function generation script**, including the determinism/verification test and the import-safety denylist guard (§2), and mechanically regenerate both existing Edge Function files with no logic change. Expanded from Revision 1 to include the strengthened guarantees.

---

## Summary of Changes Made in This Revision

1. **AsyncStorage migration (issue 1)**: replaced the nested `{ schemaVersion, state }` envelope — which was shown to break backward compatibility given the actual hydration code's `{ ...initialState, ...parsed }` merge pattern — with a flat, per-field-defaulting approach (`schedulePeriods ?? []`) matching the existing `migrateChallenges`/`backfillTimestamps` convention already used in this codebase. No version number is introduced. Added six specific tests, including one that directly simulates old code's merge logic against new data to prove the backward-compatibility claim.

2. **Momentum State hysteresis (issue 2)**: retracted the claim that evidence-window size alone provides hysteresis. Introduced an explicit candidate-state / confirmed-state split, with confirmation requiring 3 consecutive agreeing candidate evaluations before a transition takes effect. Specified this remains fully derived (a pure forward scan over schedule + logs, no persisted state) and explicitly surfaced the `O(n)`-rescan performance trade-off and the hypothetical (not adopted) cached-state alternative. Added transition-stability fixtures (single anomaly, confirmed transition, flapping).

3. **Recovery ambiguity (issue 3)**: committed to one precise definition — Recovery Rate measures recovery on the first available Scheduled Opportunity, computed pairwise, with a long unbroken miss streak producing multiple resolved "not recovered" instances by design. Defined Recovery Time as a deliberately coarser, Lapse-level metric. Added six worked date-by-date examples and a sixteen-fixture behavioral-contract table covering all required scenarios plus edge cases, carried into §8 as the executable-test specification.

4. **Local date handling (issue 4)**: identified and removed a `new Date(dayKey)`-style UTC-shift bug in the schedule resolver's weekday check; replaced with a shared `parseDayKeyParts`/`weekdayOf` utility built on the same safe local-constructor pattern already used elsewhere in this codebase, with a multi-timezone test requirement.

5. **Habit start behavior (issue 5)**: added an explicit hard floor — no Scheduled Opportunity, miss, or Lapse can exist before a habit's local creation date, regardless of schedule period data.

6. **Schedule-period ordering (issue 6)**: added a final, purely-for-determinism `id`-lexicographic tie-breaker for the residual case where both `effectiveFrom` and `createdAt` are identical.

7. **Shared domain implementation (issue 7)**: strengthened the generated-Edge-Function approach with three concrete guarantees — deterministic text-splice generation, a Jest-based freshness/verification test, and a static import denylist enforced by the generator itself.

8. **Recovery Rate time horizon (issue 8)**: reconsidered lifetime-only; proposed computing both lifetime and a rolling (last-10-resolved-instances) Recovery Rate internally, since both are derived-on-read with no material additional cost, explicitly leaving the Phase 3 presentation choice open.

No other section's substance changed beyond what was required to keep the document internally consistent with the above (e.g., commit descriptions in §9 updated to match).

## Remaining Product Decisions Requiring Approval

- The low-recovery-rate "shame threshold" (proposed `0.3`) and the rolling-window size (proposed 10 resolved instances) are still first proposals, not specified by the spec.
- The Momentum State threshold table, and the choice of a uniform 3-opportunity confirmation count applied to all states rather than a confirmation count that also scales with state "strength," are both first proposals requiring sign-off.
- Whether Recovery Rate should ultimately be presented as lifetime, rolling, or both is explicitly deferred to Phase 3, per the instruction — not decided here.
- The choice to define Recovery Rate as first-available-opportunity recovery (rather than an eventual/windowed reading) is this plan's committed interpretation of admittedly ambiguous spec wording — flagged below as the one remaining textual-interpretation risk, not something the spec settles with certainty.

## Confirmation

No source code, database schema, migration, test, prompt, or configuration file was modified to produce this revision. Only `docs/phase-2-implementation-plan.md` was changed.

## Internal Consistency Check Against the Locked Specification

Validated section-by-section against `docs/habit-tracker-evolution-plan.md`. Two points are surfaced as genuine remaining ambiguity rather than silently resolved:

1. **Recovery Rate's "lapse opportunity" granularity.** The spec's phrase "a lapse opportunity is any occasion on which the user missed one or more consecutive scheduled opportunities and then had a subsequent scheduled opportunity" is grammatically compatible with either this plan's pairwise reading (multiple resolving instances per long miss streak) or a coarser one--per-streak reading. This plan commits to the pairwise reading and justifies it (§3), but the spec text alone does not foreclose the alternative with certainty. This is the single largest interpretive judgment call in this document and should be explicitly confirmed, not assumed correct by virtue of appearing in an approved-looking plan.

2. **Confirmation-count uniformity for Momentum State.** The approved decision text ("stronger states such as thriving require a longer evidence window than recovering") is satisfied by this plan's varying *candidate* windows, while the *confirmation* count is uniform at 3. Whether the spec's intent extends "stronger states need more evidence" to the confirmation layer as well (not just the candidate layer) is not fully settled by the text, and is flagged here rather than decided unilaterally.

No other inconsistencies were found; every other section's design traces directly to either an approved product decision or a concrete constraint already present in the codebase (the hydration/persistence code, the hard-delete behavior of `habit_logs`, the Dashboard-paste Edge Function deployment process).

Waiting for approval before beginning Phase 2 implementation.
