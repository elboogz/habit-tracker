-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Phase 2 (see docs/phase-2-implementation-plan.md, sections 1, 4 and 6): adds the append-only,
-- effective-dated schedule/pause period model. Purely additive -- no existing table, column, or
-- row is altered or deleted by this migration.
--
-- A habit with zero rows here behaves exactly as every habit does today: daily, unpaused (see
-- lib/domain/schedule.ts's scheduleForDate default). This migration does not backfill anything
-- for existing habits and does not require any existing user to go through new setup -- nothing
-- reads or writes this table until a schedule-editing UI ships in a later phase.

create table if not exists public.habit_schedule_periods (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  -- Local day key 'YYYY-MM-DD', inclusive. The period governing a given date is the one with the
  -- greatest effective_from <= date (see lib/domain/schedule.ts's scheduleForDate) -- there is no
  -- effective_to column; a schedule change is always a new row, never an edit of a prior one,
  -- which is what guarantees changing a habit's schedule never recalculates the meaning of past
  -- periods.
  effective_from date not null,
  -- null = every day ("daily"). Otherwise the weekdays this period applies to, 0 (Sunday) - 6
  -- (Saturday), matching JavaScript's Date.getDay().
  days_of_week smallint[],
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  -- ISO timestamp of the last change -- drives last-write-wins merging during Supabase sync,
  -- consistent with every other synced table in this schema. In practice this table is
  -- append-only from the client's perspective (see docs/phase-2-implementation-plan.md section 1),
  -- so updated_at will typically equal created_at, but the column exists for consistency with the
  -- sync layer's shared merge logic.
  updated_at timestamptz not null default now()
);

create index if not exists habit_schedule_periods_user_id_updated_at_idx
  on public.habit_schedule_periods (user_id, updated_at);
create index if not exists habit_schedule_periods_habit_id_idx
  on public.habit_schedule_periods (habit_id);

alter table public.habit_schedule_periods enable row level security;

create policy "Individuals can manage their own schedule periods" on public.habit_schedule_periods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- Safe to run at any time: no other table or column depends on habit_schedule_periods, and
-- dropping it simply returns every habit to the zero-periods default (daily, unpaused) that
-- lib/domain/schedule.ts's scheduleForDate already falls back to when no periods exist. No
-- historical habit, log, or challenge data is affected.
--
-- drop table if exists public.habit_schedule_periods;
-- ─────────────────────────────────────────────────────────────────────────────
