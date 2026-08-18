# Habit Tracker Evolution Plan

## Product Philosophy

A habit tracker designed to help users keep going, especially when life gets in the way.

Progress is built by returning, not by never missing. The app remains immediately recognisable as a habit tracker. Identity-based behaviour change may influence language and coaching, but the product is marketed and experienced as a habit tracker, not an abstract identity app.

## Product Success Metrics

The objective of this redesign is to increase long-term habit adherence rather than maximise uninterrupted streaks.

The application should optimise for:

* Higher 30-day and 90-day habit retention
* More recoveries after missed scheduled opportunities
* Shorter average recovery time
* Lower habit abandonment rates
* Higher completion rates over rolling periods
* Reduced user drop-off after missing a scheduled opportunity
* Greater perceived psychological safety after lapses

Every major implementation decision should support one or more of these outcomes. These metrics are directional guidance for design decisions; they are not measurable within this codebase and are not deliverables.

## Product Principles

When choosing between two implementations, prefer the option that:

* Encourages returning over perfection.
* Reduces friction after missed habits.
* Preserves historical progress.
* Uses existing interactions before adding new screens.
* Makes behaviour understandable without lengthy explanations.
* Uses data to personalise guidance rather than judge the user.
* Encourages sustainable behaviour rather than maximum activity.
* Prioritises consistency over intensity.
* Keeps the interface calm and uncluttered.
* Presents progress as a narrative, not a score. Users should understand where they are and what their next best step is, rather than feeling defined by a single metric.

## Non-goals

The app is not intended to:

* Gamify behaviour through excessive rewards.
* Encourage obsessive tracking.
* Shame users after lapses.
* Replace professional mental health support.
* Diagnose or label the user's mental state. Coaching language stays on behaviour and patterns.
* Become a journaling application.
* Become a life coaching platform.
* Encourage maximum productivity at all costs.

## Global Implementation Constraints

These constraints apply to every phase.

* Preserve working features, existing architecture and existing styling wherever practical.
* Do not introduce unnecessary libraries.
* Do not rewrite stable code without a clear reason.
* Do not remove streak calculations until all dependencies are understood and replacements are verified.
* Do not make major database changes without documenting them first.
* All database migrations must be reversible and must never delete existing user history.
* Keep TypeScript strict.
* Use reusable components and pure utility functions for all progress calculations.
* Add comments only where behaviour is not self-explanatory.
* Do not use em dashes in any AI-generated or hard-coded user-facing copy.
* Keep the tone of all user-facing text supportive, grounded, adult and human. Avoid exaggerated praise, guilt, infantilising language and generic motivational cliches.
* Update CLAUDE.md and the README with the new product philosophy, architecture changes and progress definitions as they are implemented.
* Commit each implementation phase separately with a clear commit message.
* Do not change code until the Phase 1 audit is complete and approved.

---

## Phase 1 — Audit the Existing Application

### Objective

Understand exactly how the current application works before making any behavioural changes.

### Tasks

* Audit the current data model.
* Identify where streaks are stored and calculated.
* Identify where challenges, reflections, coaching and analytics depend on streaks.
* Map every screen that references streaks or broken progress.
* Identify all notification logic.
* Identify all database migrations that may be required.
* Identify any risks, dependencies or existing bugs that should be addressed first.
* Produce a dependency report before making changes.

### Deliverable

A document describing every area affected by replacing streak-based behaviour, plus a proposed implementation sequence for the remaining phases. Stop and wait for approval before writing any code.

---

## Phase 2 — Refactor the Core Domain Model

### Objective

Replace the streak-first architecture with a recovery-first architecture before changing the user interface.

### Core Product Principle: Scheduled Opportunities

The app does not measure habits against calendar days. It measures them against scheduled opportunities.

A scheduled opportunity is any date and time on which a habit was expected to be completed according to the user's active schedule.

Examples:

* Daily habits create one scheduled opportunity each day.
* Monday/Wednesday/Friday habits only create opportunities on those days.
* Paused habits create no scheduled opportunities.
* Approved schedule changes remove the missed opportunity.
* Future scheduled opportunities must never influence progress calculations.

Every progress calculation throughout the application must be based on scheduled opportunities rather than calendar days. This includes:

* Consistency
* Completion rate
* Momentum
* Recovery events
* Recovery time
* Missed opportunities
* Coaching
* Reflections
* Charts
* Notifications
* Achievements
* Analytics
* Streak

Streak was omitted from this list in error when it was first written. The principle above is unqualified: the app does not measure habits against calendar days, and nothing in the specification argues streak should be the exception.

### Shared Domain Concepts

Introduce shared domain concepts including:

* Scheduled Opportunity
* Completion
* Reduced Completion
* Recovery Event
* Momentum
* Consistency
* Total Completions (cumulative, never resets)
* Recovery Time
* Recovery Rate
* Momentum State
* Lapse Reason

All future features must use these shared concepts rather than implementing their own calculations. Implement them as pure utility functions in a single domain layer.

### Momentum State

Momentum State is a deterministic behavioural summary computed from recent scheduled opportunities, consistency, recovery events and trend direction. It represents the user's current trajectory rather than a score.

Example states:

* Building Momentum
* Steady
* Recovering
* Rebuilding
* Thriving
* Quiet Week

Rules:

* The domain layer computes the state. The AI may explain it but must never determine it.
* No state name may carry negative judgment. Every state should read as a position on a journey with an available next step, never a verdict. Final label wording is a product decision to be confirmed before Phase 3.
* Transitions require sustained evidence (hysteresis). A user must not flip between states from a single day's data; define minimum evidence windows per transition so the state feels like a stable narrative rather than a volatile score.
* New habits and sparse data map to a neutral starting state rather than a low one.

### Recovery Rate

Recovery Rate is a first-class metric, defined precisely in the domain layer as:

Recovery Rate = recovered lapse opportunities / total recoverable lapse opportunities

Where a lapse opportunity is any occasion on which the user missed one or more consecutive scheduled opportunities and then had a subsequent scheduled opportunity on which recovery was possible.

Edge cases the domain layer must handle:

* A new habit or user with no lapses yet has no Recovery Rate. Display nothing or "No lapses yet" rather than a meaningless 100%.
* Sparse data (fewer than three lapse opportunities) should be treated as insufficient for a percentage; prefer showing recovery time or total completions instead.
* Paused periods and approved schedule changes do not count as lapse opportunities.
* A low Recovery Rate must never be displayed in a shaming way. Below a sensible threshold, surface recovery time or total completions instead of the percentage.

### Deliverable

A new reusable domain layer that powers the remainder of the application.

---

## Phase 3 — Design the Progress Experience

This phase redefines how the entire app communicates progress, starting with the Today screen. Replace streaks with healthier progress indicators. Keep the existing habit completion interaction, haptics, sound and visual feedback.

Progress is the primary concept presented throughout the application. Progress is communicated through a combination of Total Completions, Recovery Rate, Average Recovery Time, Momentum State and Weekly Consistency. No single metric should become the user's identity or dominate the experience.

Display, in narrative order:

* Progress summary
* Momentum State
* Total Completions
* Recovery Rate
* Average Recovery Time
* Weekly Consistency
* Monthly Progress
* Recovery Count

The first thing a user should feel on opening the app is "I'm doing okay", not "I'm at 87%". Lead with the Momentum State narrative; percentages and counts support it.

Recovery Rate remains the product's signature differentiator for marketing and App Store presentation (subject to the edge-case rules in Phase 2), but within the app it is one element of the progress narrative, not the user's identity.

Streaks may remain available as a secondary statistic if technically useful, but they must not dominate the interface, trigger shame-based messaging or imply that previous progress has been erased.

### Recovery Celebration

When a user completes a habit after one or more missed scheduled opportunities, detect a recovery event.

Use stronger celebration than a routine completion, reusing the existing:

* Confetti
* Haptics
* Sound

Example messages:

"That is a recovery. Coming back is the skill that builds lasting habits."

"You returned after a missed day. That matters more than maintaining a perfect record."

"Back on track. Your 23 total completions are still yours."

Only show recovery messaging when a scheduled opportunity was genuinely missed.

Do not classify these as recoveries:

* Later completion on the same scheduled day
* Paused habits
* Non-scheduled days
* Newly created habits
* Retroactive entries that did not miss a scheduled opportunity

Record recovery events for analytics and coaching.

---

## Phase 4 — Recovery Experience

Design the entire missed-habit experience. Replace punishment with guidance.

### Recovery Flow

When a user returns after missing one or more scheduled opportunities, do not lead with failure messaging. Present a lightweight interaction such as:

"Welcome back. Your previous progress is still here."

Then offer one clear action:

* Continue today
* Do a smaller version
* Skip for today
* Adjust the schedule
* Pause this habit
* Reflect

The user must be able to resume with one tap. Never force a questionnaire or reflection before they can continue.

### Reduced Completions

For habits with measurable targets, allow a reduced version where appropriate. For example:

* A 30-minute workout becomes a 10-minute workout.
* Read 20 pages becomes read 5 pages.
* Drink 8 glasses becomes focus on the next glass.

Record a reduced completion separately in the data model, but frame it in all user-facing language as maintaining momentum rather than cheating or falling short.

### Lapse Reasons

If the user chooses to reflect, present a lightweight prompt with tappable options:

* Too busy
* Forgot
* Low energy
* Did not feel like it
* Something else (optional free text)

One tap. Always skippable. Immediately return to the normal flow.

Store:

* User ID
* Habit ID
* Missed scheduled opportunity
* Selected reason
* Optional text
* Timestamp
* Whether skipped

Feed this data into AI coaching. Prioritise stated reasons over inferred behaviour. Only identify behavioural patterns after repeated evidence.

---

## Phase 5 — Rewrite the AI Coach

Update every coaching prompt. The AI must never treat missed days as failure.

Use as inputs:

* Recovery history
* Lapse reasons
* Momentum
* Consistency
* Total completions
* Recovery time
* Scheduled opportunities
* Habit difficulty and edits
* Reminder usage
* Repeated drop-off patterns

The coach should not merely congratulate the user or restate statistics. It should help users:

* Recover after missed days
* Recognise genuine progress
* Identify patterns
* Reduce unrealistic goals
* Adjust timing or frequency
* Choose a smaller action when motivation is low
* Understand which habits are sustainable
* Avoid all-or-nothing thinking

Coaching must be concise and practical.

Good example:

"You usually complete this habit on Monday and Wednesday, but weekends have been difficult. Rather than treating that as failure, consider changing the schedule to weekdays only."

Poor example:

"You are amazing. Keep crushing it!"

### Habit Health

The AI should distinguish between user consistency and habit health. A struggling habit may indicate that the habit itself should change rather than that the user should try harder. The domain layer should determine habit health signals using deterministic rules. The coach may explain and communicate those signals, but it must not independently infer them from raw user data. Examples of signals the coach may communicate:

* This habit may be too ambitious.
* This habit may be scheduled at the wrong time or on the wrong days.
* This habit has become easier or more established over recent weeks.

Habit health framing should also surface subtly in reflections: "This habit has been difficult at its current schedule" rather than "your consistency dropped."

### Deterministic Architecture

The AI coach must rely on deterministic code for all metrics, trend detection and behavioural summaries. The language model generates supportive wording and recommendations only. It must not calculate statistics, identify recovery events or infer behavioural trends directly from raw completion history.

Implementation:

* The domain layer computes all facts (consistency, momentum, Momentum State, recovery events, recovery rate, lapse patterns, habit health signals, behavioural trend direction) as structured data. These are deterministic outputs passed to the AI.
* Pass the coach a structured JSON object of pre-computed facts. Never pass raw completion history to the language model.
* The prompt instructs the model to use only the facts provided and never to invent or recalculate numbers.
* Validate output before display: reject responses containing statistics not present in the input.

This makes coaching testable with the simulated histories in Phase 9, keeps costs predictable and prevents the model from misstating user data.

---

## Phase 6 — Reflections

Rewrite weekly and monthly reflections.

Weekly reflections should include:

* Current Momentum State and whether momentum is improving, stable or declining
* What went well
* Where consistency dropped
* How quickly the user recovered
* Which habits may be too ambitious
* One realistic adjustment for the next week
* Recognition of cumulative progress

Momentum State gives reflections a natural narrative arc rather than a list of percentages.

A reflection must distinguish between:

* A temporary lapse
* A badly scheduled habit
* An unrealistic target
* A habit the user no longer values
* A genuine consistency improvement

Never present a low completion percentage as a verdict on the user.

Monthly reflections should focus on longer-term patterns and how the user's behaviour is evolving.

Avoid language centred around streaks.

---

## Phase 7 — Challenges & Achievements

Redesign challenges so success is no longer based on perfection. Missing one day must not automatically invalidate a challenge.

Examples:

* Complete 20 sessions this month
* Complete this habit 5 times in 7 days
* Recover three times
* Return within two days after a miss
* Improve consistency by 10%
* Build momentum for two weeks
* Complete your habit on four scheduled opportunities

Achievements should reward participation, consistency, recovery and persistence rather than uninterrupted sequences.

---

## Phase 8 — Notifications & Analytics

### Notifications

Rewrite notifications to support action without guilt. Notifications remain optional and configurable per habit.

Avoid:

* "You are about to lose your streak."
* "You missed your habit again."
* "Do not fail today."

Prefer:

* "Ready for your next step?"
* "You have already completed this 11 times this month."
* "A small version still counts today."
* "Your progress is waiting when you are ready."

### Morning-After Notification

The notification sent the day after a missed scheduled opportunity is the most sensitive message in the app. It must never reference failure, loss or broken progress. It should be factual, forward-looking and easy to act on.

Examples:

"Yesterday did not happen. That is a normal part of building habits. Today is available."

"Your 18 completions this month are still here. Ready when you are."

"Missing a day is common in real habit building. A small step today keeps things moving."

Rules:

* Never mention broken streaks.
* Never mention falling behind.
* Never encourage catching up.
* Reduce notification frequency after repeated misses rather than escalating urgency.
* Respect pauses, quiet hours and schedule changes.

### Analytics

Record, reusing existing completion and habit data wherever possible:

* Recovery events
* Recovery count
* Recovery time
* Momentum State history
* Momentum State transitions over time (to analyse how users move between states and which interventions help)
* Consecutive missed scheduled opportunities
* Lapse reasons
* Completion history
* Reduced completions
* Paused habits
* Restart events

Prefer calculating derived metrics from existing records instead of storing duplicate values, unless performance requires otherwise.

---

## Phase 9 — Migration & Testing

### Migration

Safely migrate all existing users.

* Preserve historical completions.
* Preserve streak data until migration is fully complete and verified.
* Make all migrations reversible.
* Document every migration before running it.
* Benchmark performance.

### Tests

Add or update tests covering:

* Completing a habit
* Missing one scheduled opportunity
* Missing several scheduled opportunities
* Recovery after one missed opportunity
* Recovery after several misses
* Rolling consistency calculations
* Recovery-time calculations
* Recovery Rate calculations, including no-lapse, sparse-data and paused-period edge cases
* Momentum calculations
* Momentum State determination, including hysteresis (no state flipping from single-day data), new-habit neutral state and sparse-data handling
* Coaching output validation (rejecting invented statistics)
* Reduced habit completions
* Pausing and restarting a habit
* Rescheduled habits
* Retroactive entries
* Challenge completion without perfect attendance
* Notification eligibility and cooldowns
* AI coaching with sparse data
* AI coaching with conflicting patterns
* Weekly reflection generation
* Existing data migrations

### Developer Simulation Controls

Create developer controls that allow simulated habit histories, including:

* Perfect consistency
* 50% consistency
* Three-day lapse followed by recovery
* Gradual improvement
* Gradual decline
* An unrealistic target
* A frequently paused habit
* A habit completed mostly on certain weekdays

Use these scenarios to test every message, metric, notification and recovery flow without waiting for real time to pass.

---

## Phase 10 — UI Polish & Final QA

Polish animations, typography, accessibility and onboarding.

Keep the interface familiar and simple. Do not increase the app's surface area beyond the existing screens unless a recovery screen or small modal is genuinely necessary.

The experience should feel:

* Calm
* Supportive
* Adult
* Clear
* Encouraging
* Non-judgemental
* Easy to resume

Avoid making the interface overly therapeutic, childish or filled with motivational slogans.

Update all user-facing language to reinforce the philosophy: progress is built by returning, not by never missing.

Complete usability testing across the full testing loop (browser, Expo, physical device).

Remove remaining references to streaks only after confirming every replacement system is functioning correctly.

---

## How to Begin

Begin with Phase 1 only. Audit the repository and present the dependency report and proposed implementation sequence. Do not change any code until the audit is approved.
