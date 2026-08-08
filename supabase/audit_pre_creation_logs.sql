-- Read-only audit -- no writes, no migration, no deletion.
-- Finds habit_logs rows whose date precedes their habit's local creation day, i.e. rows the
-- Phase 4 retroactive-entry defect (see git history / CLAUDE.md's "Recovery flow" section) could
-- have produced before the fix: dates that are silently invisible to every Scheduled-Opportunity-
-- based calculation (Momentum, Recovery) while still counting toward Total Completions/Consistency.
--
-- CAVEAT: habits.created_at is timestamptz; casting it to ::date evaluates in the SQL session's
-- timezone (UTC by default in the Supabase SQL Editor). The app's own floor
-- (lib/domain/schedule.ts's isScheduledOpportunity, via localDayKeyOf) evaluates in each device's
-- local timezone instead. For a user not in UTC, a log dated the calendar day before/after their
-- device-local creation day could read as a false positive or false negative right at the
-- boundary. Treat a count near zero, or offending dates exactly 1 day off, with that in mind.

-- Summary: total count and number of distinct habits affected.
select
  count(*) as total_pre_creation_logs,
  count(distinct h.id) as affected_habit_count,
  count(distinct h.user_id) as affected_user_count
from public.habit_logs l
join public.habits h on h.id = l.habit_id
where l.date < h.created_at::date
  and l.deleted_at is null
  and h.deleted_at is null;

-- Detail: per-habit breakdown, for reporting affected habit IDs.
select
  h.user_id,
  h.id as habit_id,
  h.name as habit_name,
  h.created_at,
  count(*) as pre_creation_log_count,
  min(l.date) as earliest_offending_log_date,
  max(l.date) as latest_offending_log_date
from public.habit_logs l
join public.habits h on h.id = l.habit_id
where l.date < h.created_at::date
  and l.deleted_at is null
  and h.deleted_at is null
group by h.user_id, h.id, h.name, h.created_at
order by pre_creation_log_count desc;
