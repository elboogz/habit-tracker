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

-- Users can read their own insights (for the in-app Coach card).
create policy "ai_insights_select" on public.ai_insights
  for select using (auth.uid() = user_id);

-- The ai-insights Edge Function (running under the user's JWT) can insert new insights.
-- No DELETE or UPDATE policy: only service-role callers (Edge Functions) can remove rows,
-- so users cannot delete their cached insights to bypass the Claude API freshness limit.
create policy "ai_insights_insert" on public.ai_insights
  for insert with check (auth.uid() = user_id);

-- ── MIGRATION (existing installations) ───────────────────────────────────────
-- Run the following in the Supabase SQL Editor to upgrade an already-deployed schema:
--
-- drop policy if exists "Individuals can manage their own insights"
--   on public.ai_insights;
--
-- create policy "ai_insights_select" on public.ai_insights
--   for select using (auth.uid() = user_id);
--
-- create policy "ai_insights_insert" on public.ai_insights
--   for insert with check (auth.uid() = user_id);
-- ─────────────────────────────────────────────────────────────────────────────
