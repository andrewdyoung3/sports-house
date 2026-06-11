-- Pre-generated AI match previews.
-- Writes are service-role only (no INSERT/UPDATE client policy — admin client bypasses RLS).
-- Reads are public: SELECT using (true) so the deployed app's anon client can serve previews.

create table if not exists public.game_previews (
  game_id          text        primary key,
  payload          jsonb       not null,
  model            text        not null,
  news_fingerprint text,
  updated_at       timestamptz not null default now()
);

alter table public.game_previews enable row level security;

drop policy if exists "game_previews_select_public" on public.game_previews;
create policy "game_previews_select_public" on public.game_previews
  for select using (true);

-- Grant table-level SELECT to anon and authenticated roles.
-- RLS using(true) gates the policy, but the role still needs a GRANT to reach the table.
grant select on public.game_previews to anon, authenticated;
