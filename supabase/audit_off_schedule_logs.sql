-- Read-only audit -- no writes, no migration, no deletion.
-- For every non-deleted habit_logs row, resolves the schedule/pause state in effect on that log's
-- date (mirroring lib/domain/schedule.ts's scheduleForDate: the habit_schedule_periods row with
-- the greatest effective_from <= log date, ties broken by created_at desc then id desc; no
-- matching row -> daily/unpaused default), then classifies the date as a Scheduled Opportunity or
-- not, mirroring isScheduledOpportunity's own check order:
--   (1) log date before the habit's local created_at day -> not scheduled, checked first and
--       unconditionally, before any period is even consulted;
--   (2) resolved period says paused -> not scheduled;
--   (3) resolved schedule is not daily and the log date's weekday is not in days_of_week -> not
--       scheduled;
--   (4) otherwise -> scheduled.
-- A log dated on a non-scheduled day is not a defect -- nothing in the app prevents logging a
-- habit outside its own schedule, on either the live (Today) or retroactive (Habit Detail) path,
-- and per product decision that is permitted, deliberate behaviour: such a log already counts
-- toward Total Completions and is already correctly excluded from Scheduled Opportunity adherence
-- (Consistency, Momentum, Recovery). This query exists to size the existing population, not to
-- flag it as something requiring correction.
--
-- IMPORTANT -- this is a best-effort replication of scheduleForDate's effective-dated period
-- resolution in SQL, not a direct execution of the TypeScript it mirrors. Read its output as
-- indicative, not authoritative -- if a row here looks surprising, trace it by hand against
-- lib/domain/schedule.ts before treating the count as ground truth.
--
-- CAVEAT: created_at::date and the weekday extraction (extract(dow from ...)) both evaluate in the
-- SQL session's timezone (UTC by default in the Supabase SQL Editor), while the app's own
-- equivalents (lib/domain/day-key.ts's localDayKeyOf/weekdayOf) evaluate in each device's local
-- timezone at read time -- same class of boundary caveat as supabase/audit_pre_creation_logs.sql.
--
-- OVERLAP WITH THE PRE-CREATION AUDIT: any row surfaced here for reason (1) is also a pre-creation
-- row supabase/audit_pre_creation_logs.sql already found. supabase/remediate_pre_creation_logs.sql
-- was applied 2026-08-18 (7 rows corrected, both the migration's own scoped verification and a
-- full unscoped re-audit returned 0 rows) -- so pre_creation_count below should now be 0 for every
-- row this query returns. Anything nonzero there would mean either a new pre-creation log was
-- created since the migration (both write paths that could do that are documented as structurally
-- closed in docs/phase-4-completion-report.md) or a gap in that closure worth re-investigating.
-- Any remaining count is expected to come entirely from paused_count and off_weekday_count instead.

with resolved as (
  select distinct on (l.id)
    l.id as log_id,
    l.user_id,
    l.habit_id,
    l.date as log_date,
    h.name as habit_name,
    h.created_at,
    p.days_of_week,
    p.paused
  from public.habit_logs l
  join public.habits h on h.id = l.habit_id
  left join public.habit_schedule_periods p
    on p.habit_id = l.habit_id
    and p.effective_from <= l.date
  where l.deleted_at is null
    and h.deleted_at is null
  order by l.id, p.effective_from desc nulls last, p.created_at desc, p.id desc
)
select
  user_id,
  habit_id,
  habit_name,
  created_at,
  count(*) as non_scheduled_log_count,
  count(*) filter (where log_date < created_at::date) as pre_creation_count,
  count(*) filter (where log_date >= created_at::date and paused is true) as paused_count,
  count(*) filter (
    where log_date >= created_at::date
      and coalesce(paused, false) = false
      and days_of_week is not null
      and not (extract(dow from log_date)::int = any(days_of_week))
  ) as off_weekday_count,
  min(log_date) as earliest_non_scheduled_date,
  max(log_date) as latest_non_scheduled_date
from resolved
where
  log_date < created_at::date
  or paused is true
  or (
    coalesce(paused, false) = false
    and days_of_week is not null
    and not (extract(dow from log_date)::int = any(days_of_week))
  )
group by user_id, habit_id, habit_name, created_at
order by non_scheduled_log_count desc;
