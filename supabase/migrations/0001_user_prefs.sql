-- SportHouse — Phase 1 persistence: followed teams per (anonymous) auth user.
-- Run in Supabase → SQL Editor. Safe to re-run (idempotent guards).

-- One row per user; team_ids holds the followed-team slugs (e.g. 'afl-lions').
create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  team_ids   text[]      not null default '{}',
  updated_at timestamptz not null default now()
);

-- Row-level security: each user may only see/modify their OWN row.
alter table public.user_prefs enable row level security;

drop policy if exists "user_prefs_select_own" on public.user_prefs;
create policy "user_prefs_select_own" on public.user_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "user_prefs_insert_own" on public.user_prefs;
create policy "user_prefs_insert_own" on public.user_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_prefs_update_own" on public.user_prefs;
create policy "user_prefs_update_own" on public.user_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_prefs_delete_own" on public.user_prefs;
create policy "user_prefs_delete_own" on public.user_prefs
  for delete using (auth.uid() = user_id);
