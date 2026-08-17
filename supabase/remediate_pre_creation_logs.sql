-- One-time corrective migration -- writes, not read-only. Not a general rule: scoped to exactly
-- the 7 habit IDs identified by supabase/audit_pre_creation_logs.sql (run and reported 2026-08-17;
-- 103 offending habit_logs rows across 7 habits and 3 user IDs). Do not broaden the predicate to
-- catch future rows -- both production write paths that could have produced this are already
-- structurally closed (see docs/phase-4-completion-report.md's remediation entry for this audit):
-- the retroactive-entry UI path since commit c9bac40 (lib/domain/schedule.ts's
-- retroactiveEntryWindowStart), and the developer simulation tools since commit 7bf2cc3
-- (lib/domain/dev-simulation.ts's backdatedCreatedAt). This migration exists only to correct data
-- that predates both fixes.
--
-- ROOT CAUSE, restated: these habit_logs rows are genuine, deliberately-simulated developer-tool
-- history, created by the in-app Settings developer tools before backdatedCreatedAt existed. Those
-- tools backfilled habit_logs.date into the past without moving the habit's own created_at, so
-- every Scheduled-Opportunity-based calculation (Momentum, Recovery, and now schedule-aware
-- Consistency -- lib/domain/schedule.ts's isScheduledOpportunity floors at created_at) silently
-- excluded these dates, while Total Completions (which reads raw logs, not Scheduled Opportunities)
-- counted them. The logs themselves were never wrong -- only created_at was left behind. This
-- migration applies retroactively the exact correction backdatedCreatedAt now performs
-- automatically for every simulated habit going forward: created_at moves to the local calendar day
-- of the earliest log that should have been covered, and no earlier.
--
-- DECISION: backdate, do not delete. This is deliberately-built test history being corrected, not
-- bad data being discarded.
--
-- DATE/TIME SEMANTICS -- reported, not silently approximated, per instruction:
-- lib/domain/dev-simulation.ts's backdatedCreatedAt decomposes the original createdAt via JS's
-- LOCAL Date constructor (new Date(createdAt).getHours()/getMinutes()/...), then reconstructs the
-- backdated instant via the LOCAL Date constructor again on the new calendar date, before calling
-- .toISOString(). Both the decompose and recompose steps run in whatever timezone the device
-- executing the debug-tool click was in at that moment -- so what it actually preserves is
-- "device-local wall-clock time-of-day," not "UTC wall-clock time-of-day."
--
-- Postgres's timestamptz columns store only an absolute instant -- no per-row timezone or UTC-offset
-- metadata is retained, and none was ever recorded for these rows (they predate this migration by
-- definition). There is therefore no way to determine, from the database alone, what device-local
-- timezone was in effect when each of these created_at values was originally set. Faithfully
-- reproducing backdatedCreatedAt's literal device-local semantics is not possible here, and this
-- migration does not attempt to approximate it.
--
-- What it does instead: preserves the stored UTC time-of-day exactly (hour/minute/second/
-- millisecond, computed explicitly via `AT TIME ZONE 'UTC'` rather than relying on the SQL session's
-- TimeZone setting, so the result is deterministic regardless of what timezone the Supabase SQL
-- Editor session happens to be in) and substitutes only the UTC calendar date. This is a disclosed
-- deviation from backdatedCreatedAt's literal behavior, not a fabricated stand-in for it. It is safe
-- here because every one of the 7 original timestamps sits comfortably away from UTC midnight
-- (earliest 07:11:30 UTC, latest 21:47:32 UTC) -- no plausible device timezone offset would flip
-- which calendar date the corrected value resolves to on read. Also worth noting: this data model
-- has no fixed "creation-time device timezone" to begin with -- lib/domain/day-key.ts's
-- localDayKeyOf/dayKey evaluate in whichever device is CURRENTLY reading the value, not one pinned
-- at write time, so exact UTC-vs-device-local time-of-day preservation was never going to be
-- perfectly reconstructable regardless of what this migration did.
--
-- CAVEAT -- one habit ID does not parse as a well-formed UUID as reported. The "Drink Water" habit
-- under user 4f7549e0-18ff-4be3-bb3f-4041665ebc35 was given as
-- 80fa9ad6-9912-479d-b83a-2b23897a63f, whose final segment is 11 hex characters, one short of the
-- standard 12 (checked programmatically against all 7 IDs; this is the only one that doesn't parse
-- as 8-4-4-4-12). Included verbatim below, not guessed or corrected. CONFIRM THE EXACT ID before
-- running -- if this is wrong, that row's UPDATE will match zero rows (a safe no-op, not a
-- wrong-row write), and the verification query below will still show it as offending afterwards.
--
-- Corrected date per habit = the earliest offending habit_logs.date already reported for that habit
-- (supabase/audit_pre_creation_logs.sql's earliest_offending_log_date) -- exactly what
-- backdatedCreatedAt itself computes: the minimum of every simulated date for that habit, since any
-- log dated on/after the (pre-correction) created_at is by definition not "offending" and therefore
-- cannot be earlier than the offending set.

begin;

with corrections (habit_id, corrected_date, habit_label) as (
  values
    ('b393856b-b7a2-4bdd-b231-18ab6975ea73'::text, '2026-07-05'::date, 'Listen to music (user 4f7549e0...)'),
    ('80fa9ad6-9912-479d-b83a-2b23897a63f'::text, '2026-07-07'::date, 'Drink Water (user 4f7549e0...) -- ID CAVEAT ABOVE, CONFIRM BEFORE RUNNING'),
    ('bf1b7419-45a5-44a9-95e3-dc2af4e271bf'::text, '2026-06-02'::date, 'Move my body (user 2f7d4bdf...)'),
    ('eac0e1de-1a0b-4b48-8a84-99da28ccf13d'::text, '2026-06-02'::date, 'Drink Water (user 2f7d4bdf...)'),
    ('5aec98b7-47fd-47f2-a031-e93f6758cc8f'::text, '2026-06-26'::date, 'Read (user 75288e15...)'),
    ('d2c26f86-dfa6-4658-8525-76d55d48d26f'::text, '2026-08-04'::date, 'Rest (user 4f7549e0...)'),
    ('d5a24121-177f-41b3-8453-bdc369ef82f7'::text, '2026-08-03'::date, 'Read (user 4f7549e0...)')
)
update public.habits h
set
  created_at = (c.corrected_date + (h.created_at at time zone 'utc')::time) at time zone 'utc',
  updated_at = now()
from corrections c
where h.id = c.habit_id
  -- Defensive, in addition to every corrected date above already being confirmed earlier than the
  -- current created_at by the audit itself: never move created_at later than it already is.
  and (c.corrected_date + (h.created_at at time zone 'utc')::time) at time zone 'utc' < h.created_at
returning h.id, h.name, h.created_at as new_created_at, h.updated_at as new_updated_at;

commit;

-- ============================================================================
-- VERIFICATION -- run after the migration above. Expected result: zero rows.
-- Scoped to exactly the 7 habit IDs this migration touched, not the full unscoped audit --
-- optionally also re-run supabase/audit_pre_creation_logs.sql in full afterwards for a
-- table-wide confirmation, since that query has no ID filter at all.
-- ============================================================================

select
  h.id as habit_id,
  h.name as habit_name,
  h.created_at,
  count(*) as still_offending_log_count,
  min(l.date) as earliest_offending_log_date
from public.habit_logs l
join public.habits h on h.id = l.habit_id
where h.id in (
  'b393856b-b7a2-4bdd-b231-18ab6975ea73',
  '80fa9ad6-9912-479d-b83a-2b23897a63f',
  'bf1b7419-45a5-44a9-95e3-dc2af4e271bf',
  'eac0e1de-1a0b-4b48-8a84-99da28ccf13d',
  '5aec98b7-47fd-47f2-a031-e93f6758cc8f',
  'd2c26f86-dfa6-4658-8525-76d55d48d26f',
  'd5a24121-177f-41b3-8453-bdc369ef82f7'
)
  and l.date < h.created_at::date
  and l.deleted_at is null
  and h.deleted_at is null
group by h.id, h.name, h.created_at;

-- ============================================================================
-- ROLLBACK -- restores the literal original created_at values from the audit results as reported.
-- Also bumps updated_at to a fresh now(), for the same propagation reason the forward migration
-- does: a rollback that left updated_at stale would be just as invisible to already-synced devices
-- as an unbumped forward migration would have been. Commented out -- uncomment and run manually if
-- needed; not part of the forward migration's transaction above.
-- ============================================================================

-- begin;
--
-- with originals (habit_id, original_created_at) as (
--   values
--     ('b393856b-b7a2-4bdd-b231-18ab6975ea73'::text, '2026-08-03 21:47:32.665+00'::timestamptz),
--     ('80fa9ad6-9912-479d-b83a-2b23897a63f'::text, '2026-08-05 10:35:32.274+00'::timestamptz),
--     ('bf1b7419-45a5-44a9-95e3-dc2af4e271bf'::text, '2026-06-20 19:26:47.068+00'::timestamptz),
--     ('eac0e1de-1a0b-4b48-8a84-99da28ccf13d'::text, '2026-06-20 19:26:47.068+00'::timestamptz),
--     ('5aec98b7-47fd-47f2-a031-e93f6758cc8f'::text, '2026-06-30 20:07:31.737+00'::timestamptz),
--     ('d2c26f86-dfa6-4658-8525-76d55d48d26f'::text, '2026-08-08 07:11:30.472+00'::timestamptz),
--     ('d5a24121-177f-41b3-8453-bdc369ef82f7'::text, '2026-08-05 10:35:32.274+00'::timestamptz)
-- )
-- update public.habits h
-- set
--   created_at = o.original_created_at,
--   updated_at = now()
-- from originals o
-- where h.id = o.habit_id
-- returning h.id, h.name, h.created_at as restored_created_at, h.updated_at as new_updated_at;
--
-- commit;
