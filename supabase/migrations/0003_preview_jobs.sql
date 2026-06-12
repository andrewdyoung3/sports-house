-- On-follow preview job queue.
--
-- Written exclusively by /api/warm-team (server-side, service-role client) via the
-- enqueue-on-follow path. Consumed by scripts/poll-jobs.ts (also service-role).
-- The browser client never reads or writes this table — RLS is enabled but no
-- policies are defined, so the service-role admin client (which bypasses RLS) is the
-- only write path.
--
-- Apply in the Supabase SQL editor (same as 0001 and 0002).

create table if not exists public.preview_jobs (
  id          bigint      generated always as identity primary key,
  team_id     text        not null,
  status      text        not null default 'pending',  -- pending | processing | done | failed
  attempts    int         not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Fast poll query: cheaply fetch oldest pending jobs by (status, created_at).
create index if not exists preview_jobs_status_created_at
  on public.preview_jobs (status, created_at);

-- Prevent duplicate pending jobs for the same team.
-- A team can have at most one 'pending' row; once claimed (processing/done/failed)
-- a new pending row can be inserted on the next follow.
create unique index if not exists preview_jobs_pending_team_id
  on public.preview_jobs (team_id)
  where (status = 'pending');

alter table public.preview_jobs enable row level security;
-- No policies: service-role client bypasses RLS; browser client must never touch this table.
