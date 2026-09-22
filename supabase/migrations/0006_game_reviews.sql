-- Pre-generated AI post-match reviews — the results-side twin of game_previews.
--
-- Reviews used to live only in Next's data cache on the generating machine plus
-- the viewer's localStorage, so the deployed site (no Ollama) could never show
-- one. Same access model as previews: writes are service-role only (admin
-- client bypasses RLS; no INSERT/UPDATE client policy), reads are public so the
-- deployed app's anon client can serve them.
--
-- game_id is the PERSPECTIVE id (lib/result-match-key.ts makeResultId):
-- `<teamId>-<YYYY-MM-DD>-vs-<opponent-slug>` — one review per followed side of
-- a match, since the review is written from that side.

create table if not exists public.game_reviews (
  game_id    text        primary key,
  payload    jsonb       not null,
  model      text        not null,
  updated_at timestamptz not null default now()
);

alter table public.game_reviews enable row level security;

drop policy if exists "game_reviews_select_public" on public.game_reviews;
create policy "game_reviews_select_public" on public.game_reviews
  for select using (true);

grant select on public.game_reviews to anon, authenticated;
