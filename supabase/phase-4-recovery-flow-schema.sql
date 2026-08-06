-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Phase 4 (see docs/phase-4-plan.md, sections 4.3 and 5.4): adds the lapse_reasons table plus two
-- additive columns for reduced ("smaller version") completions. Purely additive -- no existing
-- table, column, or row is altered in a breaking way, and no existing row's meaning changes.
--
-- A habit/log that predates this migration reads back with reduced_target null / reduced false,
-- which is exactly the pre-Phase-4 behavior every consumer already falls back to. No lapse_reasons
-- row exists until a user interacts with the recovery card's Skip or Reflect options.

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

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- Safe to run at any time -- no other table depends on lapse_reasons, and dropping the two
-- columns simply returns every habit/log to the pre-Phase-4 default (no reduced target, not
-- reduced) that lib/domain/habit-stats.ts's reducedTargetFor and isDoneOnDay already treat as
-- the baseline case.
--
-- drop table if exists public.lapse_reasons;
-- alter table public.habits drop column if exists reduced_target;
-- alter table public.habit_logs drop column if exists reduced;
-- ─────────────────────────────────────────────────────────────────────────────
