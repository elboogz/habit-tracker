# Phase 5 Pre-Plan Verification Report

**Produced 2026-09-08 against repository commit `edafc3cb1361d208f93bf638a21b2dce4723c454` (`edafc3c`), "Record Health Data Integrations / Verified Habits as future scope", with a clean working tree.**

**This is a pre-implementation verification report, not an approved implementation plan.** It records evidence gathered before `docs/phase-5-plan.md` is written, so that the final plan can be approved against a fixed snapshot of what was actually checked. Nothing in it authorises implementation, and no recommendation in it has been acted on. Phase 5 has not begun.

Deployment baseline at the time of the review: `block=be472da09aa4` on both Edge Functions, `file=9042dc1c3d7c` (`ai-insights`) and `file=c88749f30503` (`send-coaching-push`), each matching the repository.

No code, schema, configuration, locked-specification, roadmap or Future-scope content was changed to produce this report.

---

## Verification status per finding

Findings A to H are the repository/document findings raised for verification. Status recorded is what the review actually supports; no further investigation was performed to upgrade any status.

### A. Habit Health Acceptance Gate conflict — **verified this session**

Evidence: `grep -ni "habit health"` over `docs/habit-tracker-evolution-plan.md` returns exactly four lines (344, 346, 352, 360); lines 344-352 read directly. `docs/implementation-roadmap.md` read in full, giving line 66 (the gate question) and line 262 (the sequencing-only authority statement). `CLAUDE.md` read in full and contains no Habit Health passage.

Caveat on scope of the check: the mechanical grep was run over the locked specification only. The roadmap and `CLAUDE.md` were verified by full read rather than by grep.

### B. Generated-domain whitelist closure is broader than the draft states — **verified this session (mechanical)**

Evidence: transitive closure computed by a script reusing the generator's own declaration-scanning logic (`scripts/build-edge-functions.js`'s regex plus brace-depth approach), seeded with the proposed Step 4 call set and walked over identifier references with comments stripped. Result: 49 symbols across six source modules, with zero unresolved identifiers outside the `habit-types` shims.

Two caveats, both material to how the number should be read:

- The seed set is the **proposed** Step 4 call set, not an approved one. The exact symbol count moves if Step 4's call sites differ (for example if `CoachFacts` carries open-lapse status, which adds `openLapse` and `OpenLapse`).
- The walk is token-based, not AST-based, matching the generator's own technique. It can over-approximate (a local identifier sharing a domain symbol's name would be pulled in) but is unlikely to under-approximate, so the safe direction.

The specific claim that the draft's omissions are `day-key.ts` (4 new symbols) and `habit-stats.ts` (2 new symbols) is verified.

### C. Duplicate `OpportunityRecord` type in flat generated scope — **partially verified**

Verified: the duplication itself. `lib/domain/momentum.ts:21` and `lib/domain/recovery.ts:10` both declare `type OpportunityRecord = { date: string; completed: boolean }`, confirmed by grep and by reading both files. The generator splices declarations into a single flat file scope, confirmed by reading `buildGeneratedBlock` and `spliceIntoFile`.

**Not verified:** the failure modes. That whitelisting both produces `TS2300: Duplicate identifier`, and that whitelisting one leaves the other module's extracted functions binding silently to the survivor, are **reasoned from** `extractDeclarations`' and `buildGeneratedBlock`'s behaviour. Neither was demonstrated by actually extending `SOURCES` and running the generator.

### D. Step 1 full-file type-check configuration — **partially verified**

Verified empirically, by running all three configurations and capturing exact compiler output:

- the draft's literal recipe produces 3 errors, including `TS1501` on `sanitizeContent`'s `/u` regex flag, because passing files on the command line makes `tsc` ignore `tsconfig.json`;
- adding `--target ESNext --lib ESNext,DOM` produces 19 errors, 18 originating in `node_modules/@types`;
- a dedicated tsconfig with constrained `types` and `moduleResolution`, plus minimally typed SDK stubs, reaches **exit 0**;
- with `any` stubs instead of typed ones, `TS7006` is reported at `ai-insights/index.ts:315`.

**Not verified:** the configuration was exercised against `supabase/functions/ai-insights/index.ts` **only**. `supabase/functions/send-coaching-push/index.ts` was never put through the type check. Its clean pass is assumed, not demonstrated, and it contains code the other file does not (`localDateKey`, `localTimeMinutes`, `timeToMinutes`, `sendExpoPush`, the `Recipient` type, and the `fetch` call to the Expo push API).

### E. Validator rejection has cron and metering consequences — **partially verified**

Verified by reading code: `supabase/functions/send-coaching-push/index.ts:338` is `if (!content) continue;` with `coach_push_last_sent_date` stamped only after a successful push; the only current null path returns inside `generateNudge` before the Anthropic call (`if (!habits || habits.length === 0) return null;`). `supabase/functions/ai-insights/index.ts:265-268` counts rows in `ai_insights` for the rate limit, and rejected content would never be inserted.

**Not verified:** the "up to roughly 96 paid attempts per user per day" figure is arithmetic from a stated 15-minute cron cadence, not an observed rate. The cron schedule itself was taken from the existing documentation rather than read from the Supabase Cron configuration.

### F. Shared prompt provenance outside `block` equality — **partially verified**

Verified: `STYLE_RULES` appears at `supabase/functions/ai-insights/index.ts:27-29` and `supabase/functions/send-coaching-push/index.ts:16-18`, with a comment at the latter acknowledging the duplication. The nudge system prompt appears at `ai-insights/index.ts:32-36` (`SYSTEM_PROMPTS.nudge`) and `send-coaching-push/index.ts:20-24` (`NUDGE_SYSTEM_PROMPT`). Both pairs are outside the `BEGIN/END GENERATED DOMAIN` markers, so neither is covered by the `block` fingerprint. The `block` fingerprint's scope was confirmed by reading `buildGeneratedBlock` and `fingerprint` in the generator.

**Not verified:** the two pairs were compared by reading the source, not by a mechanical byte-level diff. They appear identical; byte-identity is not asserted as established.

### G. Explicitly exclude `momentum()` if not required — **verified this session**

Two independent confirmations. `grep` over `lib`, `app` and `components` returns `momentum(` at `lib/domain/momentum.ts:61` (the definition) and at `lib/domain/momentum.test.ts:83` and `:90` (tests) only — no non-test caller anywhere. Separately, `momentum` does not appear in the computed transitive closure, confirming `candidateStateAt` does not reach it.

### H. Documentation reconciliation at Phase 5 close — **partially verified**

Verified by grep with exact line numbers: `CLAUDE.md:30`, `CLAUDE.md:85`, `CLAUDE.md:146`, and `docs/implementation-roadmap.md:161`. The doc comments in `lib/domain/habit-stats.ts` (on `calendarStreakForHabit` and `calendarConsistency`) and the header comment in `scripts/build-edge-functions.js` were read directly.

**Not verified / partial:** the "CLAUDE.md AI coaching section" row of the staleness table is a general characterisation. Individual stale sentences within that section were not enumerated one by one, so that row is a pointer to an area rather than a complete inventory.

---

## Report-item completeness

For the eleven report items requested. Status is what the existing review supports; no new investigation was performed for this section.

| # | Item | Status | What remains |
|---|---|---|---|
| 1 | Recovery Rate horizons and `CoachFacts` closure | **Partially answered** | The Recovery Rate question is fully answered and mechanically verified. The wider audit ("any other draft field with no concrete use") is answered against the **draft's informal field list**, not against a real `CoachFacts` type, which does not exist yet. One field ("Scheduled Opportunity counts") was flagged as under-specified rather than resolved. |
| 2 | Momentum State versus Habit Health precedence | **Fully answered** | Proposal delivered with supporting evidence. Awaits ruling. |
| 3 | Log fetch horizon, with actual numbers | **Partially answered** | See the explicit limitation below. Production row counts, user counts and payload sizes were never measured. |
| 4 | Validator non-numeric Habit Health rule versus copy variation | **Fully answered** | Three options assessed against the quoted copy-variation contract, with a recommendation and an explicit statement of what option 2 does and does not protect. |
| 5 | Non-fact numeric-form inventory | **Partially answered** | The inventory was derived from the three **shipped prompts** and from reasoning about what they would elicit. No real generated output was sampled: the `ai_insights` table was never read, so the inventory is not grounded in observed coach output. |
| 6 | Habit Health candidate constants | **Fully answered** | Delivered with flip frequency, false-positive rates, detection latency and gate cost. Caveats recorded in the section itself: histories are synthetic, and the mechanism simulated is an instrumentation implementation of the approved architecture, not the eventual `lib/domain/habit-health.ts`. |
| 7 | Step 4 observability | **Fully answered** | Proposal delivered. Awaits ruling. |
| 8 | Habit Health Acceptance Gate conflict | **Fully answered** | Source conflict quoted with line references; resolution recommended; no document modified. |
| 9 | Step 1 configuration and generator hazards | **Partially answered** | The type-check configuration is validated against `ai-insights` only, not `send-coaching-push` (finding D). The closure and `momentum()` questions are fully answered; the `OpportunityRecord` failure mode is reasoned rather than demonstrated (finding C). |
| 10 | Shared prompt provenance | **Fully answered** | Verified subject to finding F's byte-identity caveat; two mechanisms compared with a recommendation. |
| 11 | Rejection policy end-to-end | **Fully answered** | One coherent design covering all listed concerns. The proposed TTL values are proposals, not validated against observed rejection rates, of which there are none. |

### Explicit limitation on item 3

**The performance and volume conclusions are not based on representative production data, and must not be read as evidence that no scaling problem exists.**

What was actually done: the real `lib/domain/` functions were compiled and driven with **synthetic** habit histories of 90, 180, 365, 730 and 1095 days at 85% completion. The CPU timings are genuine measurements of the real domain code, but the inputs were generated, not sampled.

What was **not** done, and is therefore unevidenced:

- The Supabase database was never queried. **No production row counts, habit counts, habit ages or opted-in user counts were obtained.**
- The payload figures (for example "215 KB for 5 habits at 730 days") are **computed** from synthetic row counts multiplied by an estimated ~70 bytes per row. No payload was measured.
- The number of users the cron loop currently iterates is unknown.

Consequently:

- The statement that read volume is "a non-issue" rests on synthetic assumptions and an estimate, and is **not established**.
- If current data volume is near zero — a small number of recently created habits on a development account — then that is **absence of representative evidence, not evidence of absence of a problem.** The scaling curve is a property of habit age and will be traversed as real habits age, whatever today's volume is.
- What the measurements do establish independently of volume is the **shape** of the cost: `confirmedStateAt` grows super-linearly with habit age while every other fact measured stays flat and sub-millisecond. That relative finding does not depend on production sizing.

Sizing against real data remains outstanding and belongs to the Phase 5 plan.

---

## MVP discipline note

This document is an evidence snapshot. Only one item in it is identified as a correctness blocker: the `confirmedStateAt` cost finding below. Everything else is either a settled verification, a proposal awaiting a ruling, or recorded debt. Nothing here is to be expanded into further architecture or investigation. The priority remains getting the MVP to testers.

---

# The report

Content below is preserved as produced. Presentation-only styling has been dropped; substance, figures and wording are unchanged.

---

## The blocker: confirmed Momentum State cannot be computed server-side at current cost

**Class A — correctness. New; did not come from the review list.**

This surfaced while measuring the log-fetch horizon (report item 3), and it changes that item's answer entirely.

`confirmedStateAt` walks every Scheduled Opportunity from habit creation, calling `candidateStateAt` once per opportunity. Each of those calls re-derives `recordsUpTo` *and* `closedLapses` from creation, and `isDoneOnDay` filters the entire log array on every date. The cost is roughly O(n²·L). Its own doc comment at `lib/domain/momentum.ts:229` predicts this and calls it "not a practical concern today" — which was true while it only ever ran on-device for one user's live screen.

### Measured — Node 22 (same V8 family as Deno), daily schedule, 85% completion

| Habit age | Logs | confirmedStateAt | recoveryRate (lifetime) | averageRecoveryTime | consistency (14d) | totalCompletions |
|---|---|---|---|---|---|---|
| 90 d | 79 | 20.3 ms | 0.37 ms | 0.18 ms | 0.365 ms | 0.023 ms |
| 180 d | 154 | 63.2 ms | 0.31 ms | 0.30 ms | 0.031 ms | 0.006 ms |
| 365 d | 308 | 348.3 ms | 0.85 ms | 1.01 ms | 0.040 ms | 0.006 ms |
| 730 d | 629 | **2 157.9 ms** | 2.78 ms | 2.71 ms | 0.058 ms | 0.009 ms |
| 1095 d | 939 | **6 649.5 ms** | 5.64 ms | 5.79 ms | 0.082 ms | 0.014 ms |

### Per coaching invocation

| Shape | CPU | Log rows | JSON payload |
|---|---|---|---|
| 3 habits × 365 d | 991 ms | 924 | 63 KB |
| 5 habits × 365 d | 1 676 ms | 1 540 | 105 KB |
| 5 habits × 730 d | **10 834 ms** | 3 145 | 215 KB |
| 10 habits × 730 d | **22 008 ms** | 6 290 | 430 KB |

> **This inverts report item 3.** You asked me to size the read volume. The read volume is a non-issue — 215 KB for the realistic worst case, over an indexed `habit_logs_habit_id_idx`. The constraint is CPU, and it sits entirely in one function.
>
> `send-coaching-push` makes this worse than the numbers suggest: it iterates recipients **serially** inside a single cron invocation. At 1.7 s per user, a few dozen opted-in users exhausts any plausible invocation budget, and the failure is a partial run in which some users are silently never reached.

*(Persistence note: the "non-issue" claim above is subject to the item 3 limitation recorded earlier in this document. Row counts and payload sizes are synthetic and estimated, not measured against production.)*

### The remedy, and why it does not breach the derived-on-read architecture

The doc comment names one fix and rejects it: caching the last confirmed state and rescanning forward, which is stored state. That rejection stands. But there is a second remedy it does not consider, and it introduces no state at all.

Within a single `confirmedStateAt` call, `recordsUpTo` and `closedLapses` are functions of `asOfDate` only, and the walk is strictly ascending. Both can be computed once for the full history and sliced per step, and `isDoneOnDay`'s repeated `logs.filter` can be replaced by a per-call index built once. Every output is identical, nothing is persisted, and the calculation remains derived-on-read. It is a pure-function optimisation inside one call boundary.

Profiling supports this being the whole cost: at 730 days a single `candidateStateAt` is 6.25 ms and a single `closedLapses` is 2.94 ms, and `confirmedStateAt` pays that repeatedly across 731 opportunities.

**What is needed.** This must be Phase 5 scope — the phase's own deliverable depends on it, and the alternative (capping the horizon) would change lifetime semantics for performance, which was explicitly forbidden. Proposed as **Step 2a**, repository-only, gated on the locked `perfect_completion_history` fixture timings and `lib/domain/momentum.exhaustive.test.ts` both passing unchanged. Note the exact Supabase CPU ceiling should be confirmed against current docs; the serial cron loop makes this a problem well before any specific limit is reached.

---

## Report item 1 — Recovery Rate horizons and `CoachFacts` closure

**The lifetime horizon has no existing use anywhere in the product.** `recoveryRate()` returns both, but every call site reads `.rolling` and nothing reads `.lifetime`:

- `app/(tabs)/progress.tsx:113` — `recoveryRateLine(rate.rolling, recoveryCount)`
- `app/habit/[id].tsx:38-39` — `rate.rolling.displayAsPercentage`, `rate.rolling.rate`

**Proposal: carry rolling only.** It is what the user already sees on Progress and Habit Detail, so the coach and the screens cannot quote different recovery numbers at each other. Dropping lifetime saves no compute (2.78 ms at two years, and `recoveryRate` computes both regardless) — the justification is closure discipline, not cost.

### Full field audit against decision 4's "identified existing coaching purpose" test

| Draft field | Existing Phase 5 purpose | Verdict |
|---|---|---|
| confirmed Momentum State | Primary in-app narrative since Phase 3 | keep |
| Recovery Rate — rolling | "Recover after missed days"; shown on both screens | keep |
| Recovery Rate — lifetime | none found | **drop** |
| Average Recovery Time | "Recover after missed days" | keep, gated |
| Total Completions | "Recognise genuine progress"; Phase 3 anchor metric | keep |
| Consistency, schedule-aware | Only statistic the coach cites today; resolves C2 | keep |
| "Scheduled Opportunity counts" | under-specified in the draft | narrow to 2 |
| Lapse-reason distribution | Spec: "prioritise stated reasons over inferred behaviour" | keep |
| Habit Health verdict | The MVP signal | keep, conditional |
| Recovery count | Shown on Progress today | keep |

**Narrow the opportunity counts to exactly two numerals** — the lifetime Scheduled Opportunity count, and the window count that is Consistency's own denominator. Anything further is supplied on the chance the model finds it useful, which is the thing decision 4 forbids.

> **A trap in the draft worth closing now.** `RecoveryRateResult` carries both `rate` and `displayAsPercentage`. Passing a rate together with a flag saying "you may not show this as a percentage" puts a display rule the domain layer already decided into the model's hands, and the enumerable set then contains a number the model was never permitted to state. **When `displayAsPercentage` is false, omit the rate from `CoachFacts` entirely.** Structural enforcement, exactly as with the A3 exclusions — a number that is not in the payload cannot be validly quoted, and the validator needs no special case.

---

## Report item 2 — Momentum State versus Habit Health precedence

Your expectation holds, and the repository supports it. Confirmed Momentum State passes through the hysteresis fold; Habit Health is a single-pass computation by the A2 ruling. Precedence should follow evidential strength, and Phase 3 already made the Momentum badge plus its one-line narrative the lead of the Behaviour Snapshot.

`CLAUDE.md` also forbids the inverse arrangement directly: *"An apparent clash between a confirmed Momentum State and a history-level statistic on the same screen is not a defect and must not be resolved by threshold tuning or by gating one concept's display on the other's output"* — naming the removed `isNew` gate as the defect this rule exists to prevent.

### Proposed rule, three clauses

1. **Momentum State always leads** and is never suppressed, reworded, or softened by the Habit Health verdict.
2. **Habit Health is verbalised only when the verdict is the positive signal.** The other two verdicts are never spoken. They are the absence of a signal, not a fact about the user.
3. **No sentence may relate the two** as cause and effect, as agreement, or as contradiction. They answer different questions about the same history.

Clause 2 is the one that does the work, and it is enforceable structurally rather than by prompt instruction: **`CoachFacts` simply omits the Habit Health field unless the verdict is the positive signal.** "No positive signal" then cannot become negative coaching, because the model never receives anything to negate.

> **This does not contradict architecture decision 3.** That decision requires *insufficient evidence* and *evidence without the positive signal* to stay distinct so no consumer has to re-derive the difference. The *domain function* still returns all three values, which is where decision 3 places the requirement. They are collapsed only in the model payload, where the distinction has no coaching use and where exposing it would invite exactly the negative framing clause 2 exists to prevent.

---

## Report item 6 — Habit Health constants

The approved mechanism was implemented as instrumentation — two adjacent equal-length blocks of Scheduled Opportunities, recent against preceding, gated on the smaller block's opportunity count, with today's own opportunity excluded per the module-wide rule — and driven with the real `scheduledOpportunitiesUpTo` and `isDoneOnDay` against generated histories. Every run is deterministic and reproducible from fixed PRNG seeds.

> **First finding: the approved architecture implies a third constant the brief does not name.** Comparing two completion rates needs a **margin** — the minimum rate difference that counts as improvement. Without one, any single extra completion reads as improvement. A fixed margin is a stateless threshold, not a deadband, so it does not engage the single-hysteresis rule or the A2 tripwire. And the measurements below show **margin, not block length, is the dominant control on volatility**, which qualifies the framing that block length is the principal one.

### Stability and false positives — 220 consecutive evaluation days per scenario

For the steady and alternating scenarios nothing is actually improving, so any positive signal is a false positive. `flips` counts verdict changes per 100 days.

| Combination | steady 85% flips / signal | steady 60% flips / signal | week on/off flips / signal | Mon/Wed/Fri flips / signal | real improvement detect / hold |
|---|---|---|---|---|---|
| L=14 gate=10 margin=15pp | 2.7 / 6.4% | 12.7 / 15.5% | 0.0 / 0% | 0.0 / 0% | 7 d / 1 d |
| **L=14 gate=10 margin=25pp** | **1.4 / 1.4%** | **4.3 / 7.5%** | **0.0 / 0%** | **0.0 / 0%** | **9 d / 12 d** |
| L=14 gate=10 margin=30pp | 0.7 / 0.4% | 2.1 / 5.0% | 0.0 / 0% | 0.0 / 0% | 11 d / 6 d |
| L=21 gate=14 margin=10pp | 4.1 / 12.7% | 12.3 / 23.2% | **14.1 / 35.0%** | 0.0 / 0% | 10 d / 24 d |
| L=21 gate=14 margin=20pp | 1.8 / 1.8% | 3.6 / 8.2% | **14.1 / 20.9%** | 0.0 / 0% | 13 d / 18 d |
| L=28 gate=20 margin=10pp | 6.4 / 16.8% | 14.1 / 25.5% | 0.0 / 0% | 0.0 / 0% | 8 d / 3 d |
| L=28 gate=20 margin=15pp | 1.8 / 2.7% | 3.2 / 9.1% | 0.0 / 0% | 0.0 / 0% | 18 d / 26 d |

### Second finding: block length resonates with the user's own rhythm

The alternating scenario — seven opportunities on, seven off, a very ordinary weekday-only pattern — is stable at **zero flips** for L=14 and L=28, and catastrophic at L=21: **14.1 flips per 100 days, and a spurious "improving" verdict on 21% to 35% of all days.** Widening the margin does not fix it; it only reduces how often the false verdict shows.

This is not noise. It is the mechanism correctly measuring a phase artefact. A block that is an integer number of the user's cycles always compares like phase with like; L=21 is one and a half cycles, so each block straddles a different part of the rhythm and the difference genuinely swings. **Constrain L to a multiple of 7 and record the reason**, so nobody later "tunes" it to 21 and reintroduces this.

### Third finding: the evidence gate has a severe silence cost on non-daily habits

Calendar days from habit creation until Habit Health can return anything other than insufficient evidence:

| Combination | Daily | Mon / Wed / Fri | Weekends only |
|---|---|---|---|
| **L=14 gate=10** | **24 d** | **57 d** | **86 d** |
| L=14 gate=14 | 28 d | 67 d | 100 d |
| L=21 gate=14 | 35 d | 83 d | 122 d |
| L=28 gate=20 | 48 d | 113 d | 170 d |
| L=28 gate=28 | 56 d | 132 d | 198 d |

L=28 means a Mon/Wed/Fri habit says nothing for **113 days** and a weekend habit for **170**. The Acceptance Gate runs immediately after Phase 5; on those settings no tester would ever see the signal on a non-daily habit.

### Recommendation

> **L = 14 Scheduled Opportunities · gate = 10 · margin = 0.25**
>
> It is phase-safe on weekly rhythms, has the lowest false-positive rate of any combination tested on a well-established habit (1.4% of days), detects a genuine 55%→90% improvement nine days after it begins and holds it for twelve, and reaches its first verdict in 24 days on a daily habit rather than 48.
>
> If you want fewer false positives and accept a briefer signal, **margin = 0.30** is the alternative: 0.4% on a steady 85% habit, 5.0% on a steady 60% habit, detection at eleven days.

**The honest cost, stated rather than buried:** a habit sitting at a genuinely unchanging 60% completion rate is told it is improving on roughly 7.5% of days at the recommended settings. Low-completion habits are intrinsically noisier — binomial variance peaks near 50% — and no block length tested removes this. It is the price of a stateless signal without a deadband, which is the architecture that was approved.

### Two properties to record in the plan

- **The margin is quantised.** At L=14 the rate difference moves in steps of 1/14 = 7.14pp, so margins of 0.15 and 0.20 are behaviourally identical (both mean "at least 3 more completions in the recent block"), as are 0.30 and 0.35. Only about four distinct behaviours exist. Record the chosen value together with its integer meaning, so a later small adjustment is understood to be either a no-op or a full step.
- **The signal is transient by construction.** Once the improvement sits fully inside both blocks there is no longer a difference to report and the verdict returns to no-signal. That is semantically correct for a claim about "recent weeks" and **must never be presented as decline** — which is precisely why architecture decision 6's qualification matters. No declining state is proposed and none is needed.

---

## Report items 4 and 5 — Validator: numeric forms and the Habit Health rule

### Non-fact numeric inventory

All three shipped prompts ask for one to five plain sentences with no markdown. The numeric forms that can legitimately appear:

| Form | Example | Behavioural statistic? |
|---|---|---|
| Percentage | "82% consistency" | yes — must be in `CoachFacts` |
| Count | "12 completions" | yes |
| Duration as measurement | "you usually return in 4 days" | yes — Recovery Time. **Not exempt.** |
| Duration as temporal language | "over the next few days", "this week" | no |
| Date | "since 3 March" | no |
| Ordinal | "the first week" | no |
| Time of day | "at 7am" | no — configuration, not behaviour |
| Spelled-out integer | "twice", "three days" | ambiguous — can be either |

**The correction is right and the generic duration exemption is removed.** On whether the two duration senses can be separated deterministically: **only partially, and not by the numeral.** Ordinary temporal language is overwhelmingly forward-looking; a measured duration is backward-looking or habitual. A rule keyed to a small closed set of forward markers would separate most cases — but "this week you returned in 3 days" mixes both in one sentence, and "a month from now" contains no digit at all, so a numeral-based validator never even inspects it.

> **Rather than erring on either side, constrain the output instead of the validator.** Add one prompt rule: *write any number describing the user's behaviour as a digit; never spell it out*. Then digits are all checked against the enumerable set, and spelled-out numerals are non-facts by policy rather than by guess.
>
> This converts an undecidable language problem into a formatting instruction, it is testable in Jest, and `sanitizeContent` already establishes the precedent of deterministically enforcing something the prompt merely asks for. If this is rejected, the fallback is to **err toward accepting** — reject only digits absent from the set, never prose — because a validator that rejects ordinary sentences will be switched off within a week.

**Normalisation still required** for the digits that are checked: 0.82 ↔ 82% ↔ 82, and a stated rounding tolerance. Proposed: admit only the exact value and its round-to-nearest-integer percent, nothing wider.

### The non-numeric Habit Health rule

`CLAUDE.md`'s copy-variation contract governs this. Rule 2: *"Selection must be deterministic. Never random... Derive the choice from a stable seed (habit id plus day key), which gives deterministic variety and keeps output reproducible for fixture-based tests."* Rule 3: *"Any variant must be true whenever its state holds."* The contract already anticipates closed variant sets chosen deterministically per state.

| Option | Protection it actually provides | Cost |
|---|---|---|
| **Closed lexicon** — the Habit Health clause must be one of N approved sentences, checked by exact membership | Real and deterministic. Catches the case the rule exists for: a Habit Health claim with no verdict behind it. | No paraphrase in that one clause |
| Keyword or phrase matching with free paraphrase | **Close to none.** Catches only a model that uses the exact watchword without the verdict, and misses every paraphrase — "this one seems to be clicking lately" — which is the actual failure mode. Also false-rejects legitimate uses of the word. | Looks like a boundary, is not one |
| Remove the rule | None, honestly stated | — |

**Recommendation: the closed lexicon, made narrow by item 2's clause 2.** Because `CoachFacts` omits the Habit Health field entirely unless the verdict is positive, the validator's whole job reduces to a single check: *if no Habit Health fact was supplied, no approved Habit Health sentence may appear*. That is exact membership over a small fixed set — deterministic, cheap, Jest-testable, and fully within the copy-variation contract's own mechanism.

**If the closed lexicon is rejected, remove the rule rather than taking option 2.** Better that the plan record that Habit Health characterisation is unvalidated than claim a trust boundary that a single paraphrase walks through.

---

## Report item 11 — Rejection policy, end to end

### Verified

- **Cron retry loop — confirmed.** `send-coaching-push/index.ts:338` is `if (!content) continue;` with no `coach_push_last_sent_date` stamp. Harmless today, because the only null path is "no habits" and it returns at `generateNudge` *before* the Anthropic call. A validator rejects *after* generation, so the next 15-minute tick regenerates: up to roughly 96 paid attempts per affected user per day.
- **Metering gap — confirmed.** `ai-insights/index.ts:265-268` counts rows in `ai_insights`. Rejected text is never inserted, so it costs a model call and does not count. The limit becomes an undercount of real spend at exactly the moment spend becomes unpredictable.

### Smallest MVP-safe design

| Stage | Behaviour |
|---|---|
| Generate | Validate; on pass, sanitize, insert, return |
| First rejection | Exactly one regeneration against the same `CoachFacts`. Rejected text is discarded, never persisted. |
| Second rejection | Insert a failure sentinel row. Return no content. |
| Sentinel shape | A row in `ai_insights` with empty content. Reusing the existing table is the smallest option and inherits the freshness lookup and the rate-limit count for free — no new table, no cache-versioning infrastructure. |
| Sentinel TTL | Deliberately *not* the success TTL. Proposed: **3 h** for nudge (against 20 h), **24 h** for weekly (against 7 d), **24 h** for monthly (against 30 d). |
| Interactive caller | `ai-insights` returns 200 with null content and a reason code; `lib/ai-coach.ts` maps it to `null` as it already does for every failure. |
| Cron path | **Stamp `coach_push_last_sent_date` anyway** and send nothing. Missing one day's push is strictly better than 96 paid retries. |
| Metering | The sentinel row counts toward the existing limit, so a persistently failing user is bounded. The first, un-sentinelled rejection stays uncounted — recorded as debt below rather than fixed with a schema change. |
| Diagnostics | Kind, user id, the specific offending numerals, and the `CoachFacts` leaf-value set. **Never the rejected prose.** |

**On the TTL interactions:** the sentinel stops `getInsight('nudge')` hammering on every Progress mount, since the card fetches whenever `habits.length > 0`. A 24-hour monthly sentinel means a persistent failure retries daily rather than blanking the card for thirty days, which is the whole reason the sentinel must not inherit its content's TTL.

> **The rendering path requested before ruling.** `app/(tabs)/progress.tsx:245` is `{nudge?.content ?? 'No tip yet.'}`. A null insight today renders the literal string **"No tip yet."** inside the bordered Coach card — there is no error state and no retry affordance. **Recommendation is to keep it.** It is already a neutral absence rather than a failure notice, and any "we could not generate advice" copy would be worse for a supplementary surface.

---

## Report item 7 — Step 4 observability

Rather than invent a mechanism, extend the one that already exists and has already been proven side-effect-free in production: the authenticated `GET` short-circuit added for B6, which returned its stamp without constructing a client, reading the database, calling Anthropic, or sending a push.

**Proposal.** `ai-insights` gains one diagnostic branch that returns `buildCoachFacts(...)` as JSON and returns before Anthropic is touched and before any `ai_insights` write. It satisfies every constraint set:

| Requirement | How it is met |
|---|---|
| No second derivation architecture | Calls `buildCoachFacts` itself — the authoritative producer, unchanged |
| Cheap | No model call, no cost, no cache write, no push |
| Non-user-facing | No UI path invokes it; reached only by an explicit authenticated request |
| Scoped | User JWT plus RLS — a caller can only ever read their own facts |
| Removable | One branch, deleted in the Step 5 paste; its removal is visible in the `file` stamp |
| Minimal sensitive content | Returns habit **ids** only, never names. Everything else is numerals and enum values. |

**How expected values are established:** run the same real inputs — the habit, log, schedule-period and lapse-reason rows for the sampled account — through the repository's own `lib/domain/` in a scratch Jest fixture, reusing the authoritative implementation rather than reimplementing any calculation. Compare that object to the production JSON field by field for the same `today`.

**Coverage before Step 5 proceeds:** daily and non-daily schedules, a habit with pause history, a habit with closed lapses and recovery events, a habit with lapse reasons present, plus Momentum, Consistency and both Recovery metrics on each — and Habit Health once its constants are approved. The developer simulation controls already generate valid histories for most of these, so representative cases do not require waiting for real accounts to age.

`send-coaching-push` needs no equivalent. It computes the same facts from the same generated block, and its existing `GET` already proves it is running the same revision.

---

## Report item 9 — Step 1 configuration and generator hazards

### Finding D — the type-check configuration, exercised

The guard was built exactly as the draft prescribes and run against `ai-insights/index.ts`. Three progressive results:

| Configuration | Errors | Cause |
|---|---|---|
| `npx tsc --noEmit --strict <file>` — the draft's literal recipe | 3 | Passing files on the command line makes `tsc` **ignore `tsconfig.json`**. Default target rejects `sanitizeContent`'s `/u` flag with TS1501, plus implicit-any noise. |
| + `--target ESNext --lib ESNext,DOM` | 19 | 18 of them from `node_modules/@types` — babel, jest, react, undici-types — because `types` is unconstrained and `moduleResolution` no longer matches the project. |
| Dedicated tsconfig + **typed** SDK stubs | **0** | Clean pass against the current whitelist. |

Note that `tsconfig.json` *excludes* `supabase/functions`, so the guard cannot reuse the project config in any case. The validated configuration:

```json
{
  "compilerOptions": {
    "strict": true, "noEmit": true,
    "target": "ESNext", "lib": ["ESNext", "DOM"],
    "moduleResolution": "bundler", "module": "preserve",
    "moduleDetection": "force",
    "skipLibCheck": true, "types": []
  },
  "files": ["./<function>.check.ts"]
}
```

> **The stubs must be typed, not `any` — the draft's recipe is self-defeating under `--strict`.** With `const Anthropic: any`, TypeScript reports TS7006 at `ai-insights/index.ts:315` on `response.content.find((block) => …)`: calling a method on an `any` value gives the callback an implicit-any parameter. That error does not exist under Deno with the SDK's real types, so the stub manufactures a failure the guard then reports.

Minimum shapes that reach exit 0:

```ts
declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};
type TextBlock = { type: string; text?: string };
declare class Anthropic {
  constructor(o: any);
  messages: { create(a: any): Promise<{ content: TextBlock[] }> };
}
const createClient: any = …   // may stay `any`: nothing destructures its callbacks
```

Keep the full-file check and drop the block-only fallback as a normal path — on this evidence it is not needed. **Record that these stubs are a third maintained shim surface**, alongside the row-type shims and the duplicated prompts, and that they must be kept minimal and deliberate rather than widened whenever the guard complains.

### Finding B — the real closure is 49 symbols across six files

Computed mechanically: seeded with the call set Step 4 actually needs, then walked identifier references using the generator's own declaration-scanning logic. **Zero unresolved identifiers** outside the `habit-types` shims.

| Source module | Symbols | New relative to today's whitelist |
|---|---|---|
| `day-key.ts` | 6 | **4 new** — `daysBetween`, `localDayKeyOf`, `parseDayKeyParts`, `weekdayOf` |
| `config.ts` | 2 | both — `MOMENTUM_CONFIG`, `RECOVERY_CONFIG` |
| `schedule.ts` | 4 | all four |
| `habit-stats.ts` | 7 | **2 new** — `consistency`, `totalCompletions` |
| `recovery.ts` | 13 | all thirteen, including private `opportunityRecords`, `summarizeRate` |
| `momentum.ts` | 17 | all seventeen, including seven private helpers and `EVIDENCE_RANK` |

Full symbol lists as computed:

- **day-key.ts** — `addDays`, `dayKey`, `daysBetween`, `localDayKeyOf`, `parseDayKeyParts`, `weekdayOf`
- **config.ts** — `MOMENTUM_CONFIG`, `RECOVERY_CONFIG`
- **schedule.ts** — `isScheduledOpportunity`, `scheduleForDate`, `scheduledOpportunitiesInWindow`, `scheduledOpportunitiesUpTo`
- **habit-stats.ts** — `DayStatus`, `consistency`, `countForDay`, `isDoneOnDay`, `logsForHabitOnDay`, `recentHistory`, `totalCompletions`
- **recovery.ts** — `ClosedLapse`, `OpportunityRecord`, `RecoverableLapseInstance`, `RecoveryEvent`, `RecoveryRateResult`, `RecoveryRateSummary`, `averageRecoveryTime`, `closedLapses`, `opportunityRecords`, `recoverableLapseInstances`, `recoveryEvents`, `recoveryRate`, `summarizeRate`
- **momentum.ts** — `EVIDENCE_CHAIN`, `EVIDENCE_RANK`, `MomentumStateKey`, `candidateStateAt`, `completionRate`, `computeConfirmedMomentumState`, `confirmedStateAt`, `isCurrentlyQuiet`, `isPending`, `isRebuilding`, `isRecentShortRecovery`, `lastN`, `meetsBuilding`, `meetsRateWindow`, `recordsUpTo`, `resolvedView`, `rule2EvidenceRank`

**The two modules the draft omitted are the two already in `SOURCES`** — precisely the ones a reader skips as handled. The plan must say six existing modules, not four.

**Confirmed not required, and worth excluding by name:** `streakForHabit`, `longestStreak`, `challengeProgress`, `isRecoveryEvent`, `lapseReasonSuppressionUntil`, `nextScheduledOpportunityAfter`, `scheduledOpportunityFlags`, `recentScheduledPatternDates`, `retroactiveEntryWindowStart`, `computeConfirmedState`, `reducedTargetFor`, `isDoneToday`, and both `calendar*` functions once Step 4 switches. `openLapse` would add two symbols if `CoachFacts` carries open-lapse status — a closure question for item 1, not a technical obstacle.

### Finding G — `momentum()` exclusion confirmed

`momentum()` has **zero non-test callers anywhere in the codebase** and does not appear in the computed closure — `candidateStateAt` does not use it. Naming it as excluded in `SOURCES` makes A2's "not built on `momentum(…, window)`" *structurally unreachable* server-side rather than a prose commitment. Recommended.

### Finding C — duplicate `OpportunityRecord` confirmed

`lib/domain/momentum.ts:21` and `lib/domain/recovery.ts:10` both declare `type OpportunityRecord = { date: string; completed: boolean }`, and the generator splices into one flat scope. Whitelisting both produces TS2300; whitelisting one leaves the other module's extracted functions binding silently to the survivor, which works today only because the shapes happen to match.

> **Smallest de-duplication, using the existing architecture and adding nothing:** `momentum.ts` already imports `closedLapses` from `recovery.ts`, so the dependency direction already runs that way. **Export the type from `recovery.ts` and import it in `momentum.ts`** — one export keyword, one import line, no new module, no new abstraction layer, and no change to the dependency graph. `SOURCES` then lists `OpportunityRecord` under `recovery.ts` only.

### Shim risk the plan must cover

The row-type shims need `Habit.createdAt` plus new `HabitSchedulePeriod`, `ScheduleDays` and `LapseReasonEntry` shapes and their snake_case row counterparts. These live in `lib/habit-types.ts`, outside `DOMAIN_DIR`.

**Recommendation: keep them hand-maintained and guarded by the Step 1 type check, rather than extending the generator to reach `habit-types.ts`.** This departs from the precondition review's B1 assumption that "the generator itself would need changing" — deliberately, and for a reason that did not exist when B1 was written: the type-check guard converts the stale-shim failure from silent to loud. A missing `createdAt` becomes a compile error in `npm test`, which is exactly the failure mode the generator change was meant to prevent, obtained without generator complexity.

---

## Report item 10 — Shared prompt provenance

**Confirmed.** `STYLE_RULES` is byte-duplicated at `ai-insights/index.ts:27-29` and `send-coaching-push/index.ts:16-18`, with a comment at the latter acknowledging the duplication. The nudge system prompt is duplicated the same way. Neither sits inside the generated block, so **both functions can carry identical `block` fingerprints while running different prompt instructions** — and D1 makes the nudge one artifact with two producers, so prompt text is as much a part of provenance as the domain code.

| Mechanism | Guarantee | Cost |
|---|---|---|
| Jest test asserting the two constants are byte-identical | Detects drift *in the repository*. Deployment drift is already covered by `file`-against-repo comparison. | Lowest. No generator change, no new module. |
| **Shared prompt constants in a `lib/domain/` module, added to `SOURCES`** | Makes drift **impossible** rather than detected — one `buildGeneratedBlock()` splices identical text into both files. Brings prompts inside `block`, so cross-function comparison alone proves prompt identity without repository access. | One `SOURCES` entry. **No generator change at all** — a new dependency-free file under `lib/domain/` is already reachable and passes the import-safety guard trivially. |

**Recommendation: the shared module.** The byte-identity test is genuinely smaller and would be preferable if the prompts were staying as two short strings. But Step 5 rewrites them to consume `CoachFacts`, at which point they become the largest hand-duplicated surface in the project, at exactly the moment D1's provenance rule matters most. It also makes the prompts Jest-testable against the copy contract — an em-dash grep over prompt text becomes possible for the first time.

**Implication to record:** prompts inside `block` means every prompt edit changes both functions' `block` fingerprint and forces both to be re-pasted. That is the cross-cutting rule the plan already adopts, now mechanically enforced rather than remembered.

---

## Report item 8 — The Habit Health Acceptance Gate conflict

**The provisional expectation is correct.** The four sources, quoted exactly:

**1 — Locked specification, `docs/habit-tracker-evolution-plan.md:346`**

> "The domain layer should determine habit health signals using deterministic rules. **The coach may explain and communicate those signals**, but it must not independently infer them from raw user data."

**and line 352**

> "Habit health framing should also surface subtly **in reflections**: 'This habit has been difficult at its current schedule' rather than 'your consistency dropped.'"

The specification names exactly two surfaces — the coach, and reflections. A grep for "habit health" across the locked specification returns four lines only: 344, 346, 352 and 360. **None mentions Habit Detail, or any screen.**

**2 — Roadmap Acceptance Gate, `docs/implementation-roadmap.md:66`**

> "Habit Health — does the new signal surface clearly in Habit Detail?"

**3 — Architecture decision 3, precondition review**

> The closed enum must keep insufficient evidence distinct "because collapsing them would push that distinction into the presentation layer to re-derive, which is the `isNew` gating defect already removed once in Phase 4."

**4 — Authority, `docs/implementation-roadmap.md:262`**

> "The locked product specification (`docs/habit-tracker-evolution-plan.md`) remains the authority on what each phase builds. **This roadmap governs sequencing only.**"

> **Recommendation: option 2 — amend the roadmap Acceptance Gate.** The roadmap disclaims authority over what a phase builds, in its own words. The locked specification names the coach and reflections as Habit Health's surfaces and never names a screen. A gate line that adds a UI requirement is the roadmap exceeding the authority it explicitly renounces.
>
> Proposed replacement wording, **for approval and not applied**: *"Habit Health — does the coach communicate the signal clearly, and only when the domain layer supports it?"*

**Architecture decision 3 does not require a Habit Detail surface.** It requires the domain *function* to return three distinct values so that no consumer must re-derive the difference — a requirement satisfied whether or not a screen renders it, and satisfied by the domain layer in item 2's arrangement. Reading it as implying a screen would be reading a data-modelling rule as a UI requirement.

No other authoritative text requires a Habit Detail surface, per the checks recorded under finding A above. If Habit Health is later wanted visible in-app independently of the coach, that is a specification amendment, not a Phase 5 gap — recorded as debt below.

**Nothing has been modified. The roadmap Acceptance Gate is unchanged.**

---

## Finding H — Documentation reconciliation

What goes stale as Steps 3 to 5 land, to be added to Phase 5's completion criteria rather than treated as a phase of its own:

| Location | Claim that becomes false | Breaks at |
|---|---|---|
| `CLAUDE.md:146` — "Phase 5 constraint" | "the generated-domain block only includes `day-key.ts` and `habit-stats.ts` — neither Edge Function has access to `momentum.ts` or `recovery.ts`" | Step 3 |
| `CLAUDE.md:85` | "regenerates a whitelisted subset of `day-key.ts` + `habit-stats.ts`" | Step 3 |
| `CLAUDE.md:30` — copy-variation contract, rule 4 | "the whitelist covers only `day-key.ts` and `habit-stats.ts` and neither Edge Function can reference `momentum.ts` or `recovery.ts`" | Step 3 |
| `docs/implementation-roadmap.md:161` — Phase 8 | "the notification path must receive behavioural state as data, since the Edge Functions cannot reference `momentum.ts` or `recovery.ts`" | Step 3 |
| CLAUDE.md, AI coaching section | `calendar*` usage, the 7/14/30-day windows, absence of output validation, the "10 calls per 24 h" description once sentinels count | Steps 4–5 |
| `lib/domain/habit-stats.ts` doc comments on both `calendar*` functions | "neither Edge Function fetches `habit_schedule_periods` today" | Step 4 |
| `scripts/build-edge-functions.js` header comment | Same claim, plus the `SOURCES` rationale paragraph | Steps 3–4 |

> **One of these is a real consequence, not documentation drift.** Phase 8's state-keyed notification copy is currently justified by the claim that the Edge Functions cannot reference `momentum.ts` or `recovery.ts`. After Step 3 that is simply false — `send-coaching-push` will hold the whole behaviour engine, and its stated prerequisite dissolves. This authorises no Phase 8 work, but the roadmap line becomes untrue and should be corrected at Phase 5 close. Recorded as debt.

---

## Further discoveries, classified

| Class | Item | Handling |
|---|---|---|
| **A — correctness** | `confirmedStateAt` super-linear cost blocks server-side Momentum | Reported above; needs a scope ruling |
| B — debt | First validator rejection is unmetered; a dedicated attempts column would fix it | Record; do not build billing infrastructure |
| B — debt | Phase 8's notification prerequisite becomes false after Step 3 | Correct the roadmap line at Phase 5 close |
| B — debt | Habit Health has no in-app surface | Only if one is later wanted; it is a specification amendment |
| C — future | Structured outputs; Supabase CLI deployment; general characterisation validation | Already deferred by the settled rulings and by §D3 |

---

## The ten open decisions

Everything else in this report is verified fact or a settled ruling recorded for the plan. These ten change what the plan commits to. **None has been acted on.**

1. **Is the `confirmedStateAt` remedy inside Phase 5 scope, as Step 2a?** Recommended: yes. Repository-only, gated on the locked fixture timings and the exhaustive momentum test passing unchanged. The only Class A item.
2. **Habit Health constants.** Recommended: L = 14 opportunities, gate = 10, margin = 0.25. Alternative: margin = 0.30 for fewer false positives and a briefer signal. L must stay a multiple of 7.
3. **Drop the lifetime Recovery Rate from `CoachFacts`, and omit any rate whose `displayAsPercentage` is false?** Recommended: yes to both. Also narrow "Scheduled Opportunity counts" to exactly two numerals.
4. **Momentum leads; Habit Health verbalised only on the positive verdict; `CoachFacts` omits the field otherwise.** Recommended as stated. Structural rather than prompt-enforced.
5. **The Habit Health validator rule: closed lexicon, or remove it?** Recommended: closed lexicon. If rejected, remove the rule — keyword matching is decorative.
6. **Add a "write behavioural numbers as digits" prompt rule?** Recommended: yes. It is what makes the numeric validator coherent without touching natural-language understanding.
7. **Keep "No tip yet." as the rendering for a rejected or absent insight?** Recommended: keep. Already neutral; a failure notice would be worse on a supplementary card.
8. **Amend roadmap line 66 to the proposed wording?** Recommended: yes — option 2, per the source conflict above. Not applied; nothing has been modified.
9. **Shared prompts into a `lib/domain/` module and `SOURCES`, or a byte-identity test?** Recommended: the shared module. No generator change required, and it makes drift impossible rather than detected.
10. **Row-type shims hand-maintained under the type check, rather than extending the generator?** Recommended: yes. A deliberate departure from B1's assumption, justified by the guard turning a silent failure loud.

---

No code was changed and no document was modified to produce this report. All measurements are reproducible from the compiled domain layer with fixed PRNG seeds, subject to the item 3 limitation recorded above. `docs/phase-5-plan.md` has not been written and Phase 5 has not begun.
