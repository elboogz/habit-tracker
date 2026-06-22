-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Stores AI-generated coaching nudges and weekly/monthly reflections, with
-- last_generated freshness so the Edge Function avoids re-calling Claude
-- when a recent-enough insight already exists.

create table if not exists public.ai_insights (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('nudge', 'weekly_reflection', 'monthly_reflection')),
  period_start date,
  period_end date,
  content text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_insights_user_kind_created_idx
  on public.ai_insights (user_id, kind, created_at desc);

alter table public.ai_insights enable row level security;

create policy "Individuals can manage their own insights" on public.ai_insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
