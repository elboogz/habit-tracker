-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Mirrors lib/habit-types.ts, plus user_id (ownership) and updated_at/deleted_at
-- (last-write-wins + soft-delete, needed for local-first sync).

create table if not exists public.habits (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text not null,
  type text not null check (type in ('simple', 'count')),
  target_count int,
  reminder_times text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.habit_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  date date not null,
  count int not null,
  logged_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.challenges (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_ids text[] not null,
  duration_days int not null,
  start_date date not null,
  status text not null check (status in ('active', 'completed', 'failed')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One row per user for the flat prefs fields on HabitState.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  has_onboarded boolean not null default false,
  notifications_enabled boolean not null default false,
  notification_times text[] not null default array['09:00'],
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists habits_user_id_updated_at_idx on public.habits (user_id, updated_at);
create index if not exists habit_logs_user_id_updated_at_idx on public.habit_logs (user_id, updated_at);
create index if not exists habit_logs_habit_id_idx on public.habit_logs (habit_id);
create index if not exists challenges_user_id_updated_at_idx on public.challenges (user_id, updated_at);

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.challenges enable row level security;
alter table public.user_settings enable row level security;

create policy "Individuals can manage their own habits" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Individuals can manage their own habit logs" on public.habit_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Individuals can manage their own challenges" on public.challenges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Individuals can manage their own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
