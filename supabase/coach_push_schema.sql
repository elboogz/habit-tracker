-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Adds push-notification support for the AI Coach feature: a table of registered
-- device push tokens, plus per-user scheduling preferences on user_settings.

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "Individuals can manage their own push tokens" on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.user_settings
  add column if not exists coach_push_enabled boolean not null default false,
  add column if not exists coach_push_time text,
  add column if not exists coach_push_timezone text,
  add column if not exists coach_push_last_sent_date date;
