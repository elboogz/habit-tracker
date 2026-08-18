# Phase 3 Experience Design Plan

Planning document only. No source code, schema, prompt, or configuration file has been changed to produce this document. Phase 3 implementation has not begun.

This plan designs the experience that sits on top of the domain layer completed in Phase 2 (`lib/domain/`). It does not introduce, redefine, or duplicate any behavioural calculation. Every metric named below is either already computed by `lib/domain/` today, or is explicitly flagged as a gap rather than designed around.

---

## 1. The Behavioural Engine, As It Actually Exists Today

This section is a factual inventory of `lib/domain/` as completed in Phase 2 (verified directly against the source, not against the plan documents that preceded it), because every later section depends on knowing exactly what is and isn't available.

### 1.1 Outputs that exist and are ready to surface

| Concept | Source | Shape | Notes |
|---|---|---|---|
| **Scheduled Opportunity** | `schedule.ts`: `isScheduledOpportunity`, `scheduledOpportunitiesUpTo` | boolean / date list | Every existing habit has zero schedule periods, so this currently resolves to "every calendar day since creation" for all real data. Correct by construction, not a shortcut. |
| **Completion** | `habit-stats.ts`: `isDoneOnDay`, `isDoneToday`, `countForDay` | boolean / count | Unchanged from pre-Phase-2. |
| **Recovery Event** | `recovery.ts`: `recoveryEvents`, `isRecoveryEvent` | `{ habitId, date }[]` | Fires the instant a Scheduled Opportunity immediately following a miss is completed. Independent of Momentum State (see §6). |
| **Recoverable Lapse Opportunity / Recovery Rate** | `recovery.ts`: `recoverableLapseInstances`, `recoveryRate` | `{ lifetime: RecoveryRateResult, rolling: RecoveryRateResult }` | Both horizons computed together. Each carries its own `displayAsPercentage` flag — the domain layer already decides *whether* a percentage is safe to show, not just what the number is. Phase 3 must not re-derive this decision in a screen. |
| **Recovery Time** | `recovery.ts`: `closedLapses`, `averageRecoveryTime` | days (number or null) | Lapse-level, not pairwise — a deliberately coarser metric than Recovery Rate. |
| **Momentum (internal)** | `momentum.ts`: `momentum()` | signed number, [-1, 1] | Explicitly documented as "never directly displayed." Usable only as an internal signal for *which adjective* a narrative sentence uses (e.g. picking "steady" vs. "improving" phrasing) — never as a shown number or chart. |
| **Momentum State (candidate)** | `momentum.ts`: `candidateStateAt` | one of 7 keys | Raw, can change opportunity-to-opportunity. Internal only — never shown directly. |
| **Momentum State (confirmed)** | `momentum.ts`: `confirmedStateAt` | one of 7 keys | The displayed value. Requires 3 consecutive agreeing candidates before changing. This is the number that gives the "morning-after" experience its stability (§6). |
| **Consistency** | `habit-stats.ts`: `consistency`, `recentHistory` | fraction over a window | Still calendar-day-windowed, not schedule-aware (see gap below) — currently a no-op distinction since every habit is daily. |
| **Challenge State** | `habit-stats.ts`: `challengeProgress` | `{ daysCompleted, isFailed, isComplete, todayDone, ... }` | Schedule-aware since Phase 2 commit 6. `isFailed`'s "one miss fails the whole challenge" semantics are preserved on purpose — the partial-credit redesign is explicitly Phase 7's job, not Phase 3's. |

### 1.2 Outputs the spec names that do not exist yet — flagged as gaps, not designed around

- **Habit Health.** No `lib/domain/habit-health.ts` or equivalent exists. The master spec itself places "the domain layer should determine habit health signals using deterministic rules" under **Phase 5**, not Phase 2 or 3. Phase 3 will reserve a visual slot for it (Habit Detail, see §3) but will show nothing there yet — no proxy calculation, no inferred heuristic invented at the UI layer. This is a placeholder, not a soft-launch of the feature. **Known limitation, stated explicitly:** Habit Health is named in §2 as one of this product's differentiators against the competitive set, but it will not be visually present anywhere in the shipped Phase 3 UI — that gap only closes once Phase 5 computes it. The positioning claim is honest about being partially built, not fully realized, until then.
- **Reduced Completion.** `Habit`/`HabitLog` have no `reduced` field. This is explicitly Phase 4 scope (the Recovery Flow's "smaller version" and its data model). Phase 3's Recovery Celebration copy may *reference* the idea in future-facing language never — it must not, since the underlying data doesn't exist. Nothing in Phase 3 assumes a reduced-completion path.
- **Behaviour Trend as a displayed signal.** The spec's Phase 6 language ("whether momentum is improving, stable or declining") implies a trend-direction fact for reflections. Today, `momentum()`'s signed value is the only thing resembling this, and it is explicitly not for display. Phase 3 uses its sign only to choose narrative wording (§4) — it never appears as a number, arrow, or chart. If Phase 6 needs a formal "trend direction" enum later, that's a small, additive domain function to propose then, not something Phase 3 invents.
- **Total Completions as a named domain function.** Every screen that shows this today computes it inline (`state.logs.filter(l => l.habitId === habit.id).length` in `app/habit/[id].tsx`). This is trivial and already produces a consistent answer everywhere it's used, but it is not yet a single named export in `lib/domain/`. Recommendation for the first Phase 3 implementation commit: add a one-line `totalCompletions(habit, logs)` pure function to `lib/domain/habit-stats.ts` so every screen calls the same symbol. This is a consolidation of existing, already-correct logic, not a new calculation — flagged here so it's an explicit, reviewed step rather than something that reappears ad hoc in three more files.
- **Consistency's schedule-awareness.** `consistency`/`recentHistory`/`streakForHabit`/`longestStreak` do not take `schedulePeriods` and iterate raw calendar days. This is a real gap against the master spec's "every progress calculation...based on scheduled opportunities" mandate, but it is a **no-op today** because no schedule-editing UI exists anywhere and every habit is daily/unpaused. Not a Phase 3 blocker. Flagged so whoever eventually ships schedule editing knows these four functions need the same `schedulePeriods` threading `challengeProgress` already got in Phase 2 commit 6.

### 1.3 Prominence: what leads, what supports

**High prominence** (the primary progress narrative — matches the master spec's own display order exactly): Momentum State (confirmed, shown as a compact label badge paired with a one-line narrative directly beneath it — never a bare badge with no explanation, never a raw number), Total Completions, Recovery Rate (subject to its own display rules), Average Recovery Time, Weekly Consistency, Monthly Progress, Recovery Count.

**Secondary / supporting:** Current + best streak (permitted by spec as a secondary stat, never dominant — see the streak-placement decision in §7), the raw heatmap/calendar grid (supports the narrative, doesn't replace it), per-day completion counts.

**Not displayed at all:** raw `momentum()` value, candidate Momentum State, any invented Habit Health proxy.

---

## 2. Competitive Positioning (Built On, Not Re-Derived)

Treating the prior research as settled input, not re-litigating it:

| Reference | Principle adopted |
|---|---|
| Headspace | Calm visual hierarchy, emotional warmth in copy tone |
| Finch | Genuine delight at completion and recovery moments (already partly built via `useCelebration` — Phase 3 extends it, doesn't replace it) |
| Daylio | Optional lightweight context capture, never mandatory depth |
| Habitify | Mature analytics and habit management patterns, without adopting its "no streaks, no guilt" slogan directly — differentiation here comes from what's measured, not from copying phrasing |
| Streaks | Frictionless one-tap logging — the existing Today interaction is already this; Phase 3 must not add friction to it |
| Me+ | Rejected except for the general observation that a home-screen widget is a legitimate, low-cost utility surface (out of scope for this phase; not designed here) |

**Weaknesses explicitly rejected**, and how this product avoids each:

- *Statistic overload / crowded interfaces* → one narrative sentence leads every screen (§3, §4); numbers appear in support, never as a wall of tiles. Habit Detail's 4-stat grid becomes 3 tiles (Total Completions, Best Streak, Recovery Time/Rate context) with Current Streak folded next to Total Completions rather than a same-weight 4th tile.
- *Gamification/badges as emotional centre* → no badges, levels, or points anywhere in this plan. Milestones (§5) are quiet, not competitive.
- *Content-first navigation* → the app stays a 4-tab, action-first structure; nothing here adds a "browse content" surface.
- *Streak over-reliance* → streak demoted to Habit Detail only, always anchored next to a number that never resets (§7).
- *Loss-framed notifications, "don't break the streak"* → out of scope for Phase 3 (Phase 8 owns notification copy), but the in-app "morning-after" screen state designed in §6 is held to the identical standard now, since it's the same moment experienced in-app.
- *Guilt-by-absence ("11 days since last entry")* → the return-after-lapse state (§3, §6) never states a missed-day count as a headline fact. Duration only ever appears as Recovery Time, framed as a metric about the *lapse that closed*, never as a live ticking absence counter.
- *Leading a zero-progress row with a streak label* → directly addressed by the streak-placement decision (§7): a broken streak reads "Current: 0", never leads anything, and always sits beside Total Completions.
- *Feature accumulation, unnecessary friction, aggressive monetisation, dashboards-before-insight* → no new screens (§3), no new taps added to the core loop, no monetisation surface touched, and every screen leads with interpretation (§4) before any chart.
- *Mental-health diagnosis framing* → Momentum State labels (§7) are behavioural, never clinical; onboarding copy changes (§3.7) stay on "how the app works," never on the user's mental state.

### The actual gap in the market, and how Phase 3 turns it into product

None of the six references measure recovery or trajectory — this is the gap the Phase 2 engine already fills computationally; Phase 3's job is to make it visible without turning it into another number to obsess over.

- **Behaviour explanation, not behaviour reporting** → the Behaviour Snapshot layer (§4) exists specifically so the app says *why* a number looks the way it does, not just the number.
- **Recovery celebrated separately from consistency** → already structurally possible today (`isRecoveryEvent` is independent of the routine celebration path) — §6 makes this the product's signature moment.
- **Habit Health surfaced** → reserved slot only in this phase (§1.2); the differentiation claim is honest about being partially built, not fully shipped, until Phase 5.
- **Behavioural storytelling** → §4 is this, concretely.
- **AI interpretation from deterministic facts** → already the Phase 2 architecture's intent (facts computed here, narrated in Phase 5); Phase 3's Progress screen is where that narration surface lives today (the existing Coach card), so this plan positions it correctly rather than creating a second home for it.

---

## 3. Experience Architecture — One Screen, One Question

**No new screens or modals are proposed.** The existing five (Today, Progress, Habit Detail, Challenges, Settings) plus Onboarding are reused as-is at the navigation level; "Reflection" and "Coach" are **sections within Progress**, not separate destinations — they already live there today (the nudge + weekly/monthly toggle), and inventing a 6th/7th navigable screen for them would violate both the explicit "do not expand the app's surface area" instruction and CLAUDE.md's documented 8-screen constraint. This is the one place this plan deviates from treating the six listed "screens" as six literal destinations — flagged here as the single architectural judgment call in this section.

### 3.1 Today — "What should I do now?"

- **Primary action:** log or unlog a habit (unchanged interaction — tap to check, tap again to uncheck).
- **Primary metric:** none. Today is for doing, not reporting. The existing "N of M done today" header line stays; it's a count of today's actions, not a progress statistic.
- **Supporting metrics:** none added. The current per-habit "🔥 N day streak" subtitle is removed (see §7 streak decision) — nothing replaces it as a subtitle; the row goes back to just the habit name and emoji, with reminder indicator (🔔) unchanged.
- **Emotional goal:** calm, frictionless, low-stakes. No visible consequence of a miss anywhere on this screen (§6).
- **Interaction hierarchy:** checkbox → habit name → (count stepper for count habits) → chevron to Habit Detail. Unchanged from today.
- **Change of substance:** the celebration message logic (`handleLog`) gains one more case ahead of the existing streak-message fallback — if `isRecoveryEvent(...)` is true for today's completion, fire the recovery celebration (§6) instead of the routine one. This is the only Today-screen logic change this phase requires.

### 3.2 Progress — "How am I really doing?"

- **Primary action:** none (read-only screen), navigate into a habit for more detail.
- **Primary metric:** Momentum State, presented as a compact label badge (e.g. "Building momentum") with a one-line narrative directly beneath it explaining what the label means in behavioural terms — the badge is for scanning, the sentence is for understanding; neither appears without the other.
- **Supporting metrics, in this order** (directly the master spec's own sequence): Total Completions → Recovery Rate (rolling, per §7) with Recovery Count alongside → Average Recovery Time → Weekly Consistency → Monthly Progress. Per-habit cards follow below, each leading with its own Momentum State chip in place of today's streak subtitle.
- **Emotional goal:** "I'm doing okay" before any percentage is read. The existing 7/14-day toggle stays, but moves below the narrative section — it's supporting evidence, not the headline.
- **Interaction hierarchy:** Behaviour Snapshot paragraph (§4) → Coach nudge (existing) → Reflection toggle (existing, unchanged position/behaviour) → aggregate stats → per-habit list.
- **Change of substance:** replace the current `overallConsistency`-only header with the Behaviour Snapshot summary (§4); replace each per-habit card's "🔥 N day streak · 🏆 best N" line with that habit's Momentum State chip + one-line narrative.

### 3.3 Habit Detail — "How is this habit evolving?"

- **Primary metric:** Total Completions (the number that never resets — becomes the visually largest tile, replacing streak's current pole position).
- **Supporting metrics:** Best Streak (paired with Current Streak in one tile, not two — see §7), Recovery Time or Recovery Rate (whichever this habit's own display rules allow; if neither, show nothing rather than a placeholder), Consistency (unchanged 28-day calendar). A fourth, empty-until-Phase-5 slot is reserved and clearly labelled in this plan (not implemented) for Habit Health.
- **Emotional goal:** this habit's own trajectory, told plainly — not a report card.
- **Interaction hierarchy:** stat tiles → 28-day calendar grid → recent activity list → edit habit. Unchanged order, changed tile contents.

### 3.4 Challenges — unchanged in Phase 3

No Phase 3 change. The single-miss-fails-challenge behaviour stays exactly as Phase 2 preserved it; the partial-credit/tolerance redesign is explicitly Phase 7 scope. Included here only to confirm it was considered and deliberately left alone.

### 3.5 "Reflection" and "Coach" — sections of Progress, not new screens

- **Coach's question ("what should I change?")** is answered by the existing nudge card, unchanged in Phase 3 beyond receiving richer facts once Phase 5 ships (out of scope here).
- **Reflection's question ("what did I learn?")** is answered by the existing weekly/monthly toggle, same unchanged position. Phase 3's only responsibility toward it is making sure the facts it's fed (once Phase 5/6 rewrite the prompts) come from the same domain layer Progress itself uses — a consistency requirement, not a new build.

### 3.6 Settings — "How do I make this work for me?"

No Phase 3 change proposed. Existing reminder scheduling, sound toggle, and dev tools are unaffected by this phase.

### 3.7 Onboarding

Copy-only change: the "how it works" explainer currently sells "Streaks, your best-ever streak, and consistency charts" as the headline feature (Phase 1 audit finding). Replace with language describing the app's actual differentiator — that it tracks how you come back, not just whether you never miss — without introducing a new onboarding step or screen. No structural change to the welcome → explainer → pick-a-habit → 3-day-challenge → reminders flow.

### 3.8 Empty, sparse, milestone, and return-after-lapse states

These are states within the screens above, not destinations:

- **Empty (no habits yet):** Today's existing "Add your first habit" copy stays; Progress's empty state drops its "Streaks, consistency percentages..." sell copy (same fix as onboarding) in favour of describing the Behaviour Snapshot the user will see once they start.
- **Sparse (insufficient_data):** see §7's dedicated decision.
- **Milestone:** a round-number Total Completions crossing (e.g. every 25, or a first full month — exact cadence is a small, low-stakes implementation detail, not a product decision requiring approval here) triggers the existing celebration primitives at routine strength, with milestone-specific copy, not `big: true` — that intensity is reserved for recovery (§5), keeping the hierarchy of emotional peaks intact.
- **Return-after-lapse:** the in-app passive experience for this is §6's morning-after design. The richer interactive "Welcome back — choose one action" flow (continue / smaller version / skip / adjust schedule / pause / reflect) is explicitly Phase 4's Recovery Flow, not built here — Phase 3 only needs the celebration + the honest, stable numbers, not the action menu.

---

## 4. The Behaviour Snapshot Layer

The engine produces facts; this layer decides how they become a paragraph a person reads in three seconds before ever seeing a number.

**Composition, in order, for the Progress screen's lead section:**
1. The confirmed Momentum State badge (from the label table in §7.1), paired with a one-line narrative sentence directly beneath it, in plain language — this is the "I'm doing okay" moment. The badge alone is never sufficient; it always carries its narrative with it.
2. One sentence of concrete grounding, chosen from whichever fact is most relevant right now (a recent recovery, a long steady stretch, or — for a habit with no notable event — nothing extra, since not every check-in needs a sentence about it).
3. Only then: the numbers (Total Completions, Recovery Rate if displayable, Recovery Time, Consistency).
4. Only then: the graph (heatmap).

**Explaining changes without judgement:** when Momentum State has just confirmed a transition (candidate held 3 opportunities), the grounding sentence names *what changed* in behavioural terms ("You've completed this on your last several scheduled days"), never in verdict terms ("your consistency improved to X%"). A decline follows the identical pattern in the other direction: "This one has been quieter the last couple of weeks" — never "you failed to..." or a bare percentage drop.

**Habit Health's reserved slot:** until Phase 5 computes it, no sentence in this layer claims anything about "why" a habit is struggling beyond what Momentum State + Recovery Rate already directly support (e.g. never inventing "this habit may be too ambitious" — that's Phase 5's deterministic signal to produce, not a Phase 3 guess).

**Momentum State as context, not identity:** both the badge and the narrative sentence beneath it are phrased as a description of a stretch of time ("steady stretch," "you're in a steady stretch"), never as a label attached to the person ("you are steady"). The badge needs this discipline even more than the sentence does — a compact chip is more prone to reading as an identity label than a full sentence is, precisely because it's shorter and scanned faster. Badge wording is held to the same no-verdict standard §7.1 sets for the narrative, `quiet stretch` most of all. This is a small, consistent grammatical rule worth stating explicitly since it's easy to drift from in copywriting.

**How this differs from reporting-first trackers:** every one of the six references shows the chart or percentage first and lets the user infer meaning. This app inverts that order structurally — the sentence is not a caption under a chart, it's the first thing rendered, with the chart demoted beneath it. This is a layout/order decision as much as a copy one, and should be treated as a hard rule for this screen, not a style suggestion.

---

## 5. Emotional Design System

| Situation | Emotional objective | Design consequence |
|---|---|---|
| Routine completion | Quiet satisfaction, momentum reinforcement | Existing celebration primitives, unchanged intensity |
| Recovery | Relief + validation that returning matters more than the miss | Stronger celebration (`big: true`), recovery-specific copy anchored to Total Completions (§6) |
| Milestone | Quiet pride, not competition | Routine-strength celebration, milestone-specific one-line copy, never a badge/level UI |
| Long absence | Welcome without guilt, minimum friction back in | No day-count headline anywhere; Today looks exactly as inviting as it would on day one |
| Missed opportunity (not yet returned) | Non-event | No modal, no colour change, no counter increment shown anywhere on Today |
| Paused habit | Respected intent | Shown calmly as "Paused," generates no opportunities, no reminders — never implies failure |
| New user | Orientation without overwhelm | `insufficient_data` state (§7) — neutral, no premature percentage |
| Insufficient data | Patience framed as normal | Copy frames the wait as expected ("still gathering a pattern"), never as a shortfall |

---

## 6. The Morning-After Experience

This is the single most load-bearing design decision in this phase, because it's the first place the domain layer's honesty (or dishonesty) becomes visible to a real person.

### 6.1 Case A — a single missed opportunity

**What the engine actually does:** `confirmedStateAt` requires three consecutive *agreeing* candidate evaluations before a transition takes effect (`computeConfirmedState`, `MOMENTUM_CONFIG.transitionConfirmationOpportunities = 3`). One missed opportunity can, at most, start a *pending* transition — it cannot complete one. The confirmed, displayed Momentum State is therefore **guaranteed unchanged** by construction after exactly one miss. Total Completions is unaffected (it only counts completions). The miss creates one new, unresolved `RecoverableLapseInstance` — it does not resolve until the *next* Scheduled Opportunity, so Recovery Rate's numerator and denominator are also unchanged as of this moment. The only thing that changes today is: Current Streak (Habit Detail only) → 0, and the day's checkbox on Today is unchecked (which is visually identical to "not yet logged today," the same state a not-yet-tapped habit shows every single morning — this is itself the correct, honest signal, not a new one).

**Screen behaviour:** Today shows no banner, no colour change, no interruption. The habit's row simply shows an unchecked box, same as it would before the user has logged anything that day. Progress's Behaviour Snapshot sentence is **unchanged** from yesterday's. One small, optional line may appear in the Behaviour Snapshot section (not as a Today interruption): a single factual, forward-looking sentence, e.g. "Yesterday didn't happen for [habit]. Today is available." — never mentioning a streak, never using "missed" as a headline word if a gentler one (e.g. "didn't happen") reads more calmly.

**The principle, stated explicitly:** every reassurance the copy offers must be backed by a number already visible on screen that did not move. If the copy says "your progress is still here," Total Completions must be plainly visible, unchanged, next to it.

**Reference experience (illustrative, not final copy):**

| | Momentum | Headline | Total Completions | Recovery Rate | Current Streak | Best Streak |
|---|---|---|---|---|---|---|
| Before the miss | Building (confirmed) | "You're building momentum." | 143 | 91% | 3 | 21 |
| Day after one miss | Building (confirmed, unchanged) | "Your progress is still here." | 143 (unchanged) | 91% (unchanged) | 0 | 21 (unchanged) |

### 6.2 Case B — a multi-day lapse that closes with a return

**What the engine actually does, and why two signals must not be conflated:** the **Recovery Event** (`isRecoveryEvent`/`recoveryEvents`) fires immediately and unconditionally the moment the return is logged — it has no dependency on Momentum State or its hysteresis at all. The **confirmed Momentum State**, by contrast, may or may not visibly change on the same day: the candidate state becomes `recovering` (short lapses) or, once a few more opportunities confirm it, `rebuilding` (longer lapses), but the *confirmed*, displayed value only updates once that candidate has held for 3 consecutive opportunities. **These are two independent signals on two independent timelines**, and the UI must not wait for the confirmed state to catch up before celebrating — the celebration is driven by `isRecoveryEvent`, full stop.

**Screen behaviour:** the routine celebration path is replaced by the stronger one (`big: true`, same primitives — haptics/chime/confetti, no new reward channel) the instant `isRecoveryEvent(...)` is true for the logged completion. Recovery Count increments by one, visible on Progress. Total Completions increments normally. Recovery Rate updates per its own display rules (may newly cross the 3-sample or 30%-floor thresholds and become visible for the first time). The Momentum State label may lag behind the moment by design — the copy must never claim a state transition that hasn't confirmed yet ("you're recovering" as a felt description of the moment is fine in the celebration copy itself, since that's describing the event, not asserting the confirmed label has changed).

**Reference copy** (from the locked spec, reused rather than reinvented): *"That is a recovery. Coming back is the skill that builds lasting habits."* / *"You returned after a missed day. That matters more than maintaining a perfect record."* / *"Back on track. Your 23 total completions are still yours."*

**The principle, stated once, governing both cases:** the emotional peak in this product happens after a return, not after perfection — and the app never says anything reassuring that the numbers on screen do not already, visibly, support.

---

## 7. Product Decisions for Approval

### 7.1 Momentum State display labels

Every label reads as a position on a journey, never a verdict. `quiet` gets the most deliberate treatment, since it's shown mid-lapse.

| Internal key | Recommended label | One-line narrative tone |
|---|---|---|
| `insufficient_data` | **Getting started** | "Still gathering enough days to show a pattern." |
| `building` | **Building momentum** | "You're building a pattern that's starting to stick." |
| `steady` | **Steady** | "You're showing up for this one consistently." |
| `thriving` | **Thriving** | "This habit is running strong right now." |
| `recovering` | **Recovering** | "You're finding your way back. That's the part that counts." |
| `rebuilding` | **Rebuilding** | "You stepped away from this and you're building it back." |
| `quiet` | **Quiet stretch** | "Things have been quiet here lately. Today is a good day to return." |

Recommendation: adopt this table as-is. Final copywriting polish is normal Phase 3 implementation work, not a separate approval step — what needs sign-off here is that none of the seven reads as a verdict, particularly `quiet stretch` over harsher alternatives like "off track" or "struggling."

### 7.2 Recovery Rate presentation

Recommend **both, in different contexts, deliberately** rather than picking one universally — the honest answer here is genuinely a combination:
- **Rolling** (last 10 resolved instances) is the number shown on **Progress and Habit Detail** — it's the more actionable, "recognise genuine progress" framing the master spec itself favours over a number that "carries years-old struggles."
- **Lifetime** is reserved for the **Reflection** section's monthly view, where the cumulative, "still yours" framing is the correct register.

Both are already computed together by `recoveryRate()` at zero extra cost — this is a presentation choice only, not a new calculation.

### 7.3 Streak placement

Recommend: streak (Current + Best) appears **only in Habit Detail**, folded into a single tile alongside each other (not two same-weight tiles), and is removed from Today and Progress entirely. A broken streak displays as plain text — **"Current: 0"** — never in a warning colour, never hidden, and never standing alone: it always sits directly beside Total Completions in the same visual group, so the zero is never the only number in view. No hide toggle — it would be a Settings addition for a problem simplicity already solves by demotion.

### 7.4 Progress-narrative order on the primary screen

Recommend adopting the master spec's own stated order verbatim, with Recovery Count grouped next to Recovery Rate (they're the same underlying event set, viewed two ways): Momentum State narrative → Total Completions → Recovery Rate (+ Recovery Count) → Average Recovery Time → Weekly Consistency → Monthly Progress. No deviation proposed.

### 7.5 The insufficient_data / brand-new-habit state

For a habit with fewer than 3 scheduled opportunities (`MOMENTUM_CONFIG.insufficientData.minScheduledOpportunities`):
- Momentum State shows **"Getting started"** (§7.1), never a percentage-shaped placeholder.
- Total Completions shows its real, small value (0, 1, or 2) — always valid, always shown.
- Recovery Rate is **not shown at all** (not "0%", not even "no lapses yet" — there isn't enough history to say anything yet). Replace with the same "Getting started" framing.
- Consistency shows a raw count ("2 of 2 days"), not a percentage — a percentage on 1-2 data points is misleading regardless of the underlying math being correct.
- Streak (Habit Detail only) shows its literal small value, visually de-emphasized rather than hidden.

---

## 8. Phase 3 Principles

- Today is for action. Progress is for understanding. Coach is for interpretation. Keep these questions distinct — a screen answering more than one of them is a sign of scope creep, not richness.
- Progress is a narrative, not a verdict.
- Recovery matters more than perfection, and the interface's emotional peaks should reflect that ordering.
- No single metric should ever read as the user's identity.
- One primary question per screen, stated plainly enough that its answer fits in one sentence.
- Action comes before analytics; interpretation comes before charts.
- Identity emerges from behaviour over time — the app describes a trajectory, it does not assign a label to a person.
- Every displayed number must come from `lib/domain/`. If it doesn't exist there yet, that's a gap to flag (§1.2), not a calculation to invent in a screen.
- Simplicity beats completeness at every choice point in this phase — the goal is something real and testable with people, not a finished product.

---

## 9. Scope Guardrails

- Emotional-outcome tracking and evidence-based identity work are long-term vision, not this phase. They are named in §2 as opportunities the engine *enables*, and nothing further — no data model, screen, or copy in this plan builds toward them yet.
- Reduced Completions, the full interactive Recovery Flow ("Welcome back" action menu), Lapse Reasons, schedule-editing UI, Habit Health computation, reflection/coach prompt rewrites, challenge tolerance redesign, and notification copy rewrites are all explicitly out of scope here — they belong to Phases 4 through 8 respectively, and this plan does not anticipate their UI.
- No feature in this plan exists because it's interesting; each is traceable to a principle in the locked master specification (§8's list is the checklist to re-run against any future addition).

---

## 10. Phase 3 Success Criteria

Phase 3 is successful if a first-time user can:

- understand what to do immediately;
- complete a habit in one tap;
- understand how they are progressing in under 10 seconds;
- recover from a missed opportunity without feeling punished;
- at minimum, understand that missing a day did not erase their progress; and, ideally, after about a week of use, explain the difference between Total Completions, Recovery Rate, and Momentum State.

The last criterion is a comprehension stretch goal, not a pass/fail gate: the three headline metrics need to be distinct enough that they don't blur into one another, and this is the way to find out if they do. The criterion immediately before it — that a user feels their progress survived a miss — is the core philosophical win of this entire phase and the primary thing to validate when testing with real people.

The objective of Phase 3 is not visual perfection. The objective is a coherent, testable experience that validates the recovery-first philosophy with real users.

## Summary

Phase 3, as designed here, changes what three existing screens *say* (Today's celebration logic, Progress's lead section, Habit Detail's stat tiles) and what onboarding *sells*, without adding a single new screen, modal, tap, or domain calculation. The single biggest behavioural change is Today's celebration path gaining a recovery-aware branch; everything else is presentation and copy over facts the domain layer already produces.

Five decisions are enumerated in §7 for explicit approval before implementation begins: Momentum State labels, Recovery Rate presentation (rolling on Progress/Detail, lifetime in Reflection), streak placement (Habit Detail only, anchored to Total Completions), the Progress screen's narrative order (adopted verbatim from the spec), and the insufficient-data state's exact content.

No code, schema, or copy has been changed. Waiting for approval before beginning Phase 3 implementation.
