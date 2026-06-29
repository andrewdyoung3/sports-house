-- DAT-1: monotonic write guard for game_previews.
--
-- The preview pipeline serializes writers with a single-host /tmp lock today, but
-- the upsert itself had no concurrency guard. If generation ever runs from a second
-- writer (a Vercel function, or a manual `npm run warm:force` racing the poller
-- after the stale window), the later updated_at silently overwrites whatever is
-- there — an older/lower-quality generation can clobber a newer row with no
-- detection.
--
-- This BEFORE UPDATE trigger makes the row monotonic: an update whose updated_at is
-- not strictly newer than the stored row is skipped (RETURN NULL cancels just that
-- row's update; the statement still succeeds). New inserts are unaffected — the
-- trigger is UPDATE-only, so the first write for a game_id always lands.
--
-- App code is unchanged: upsertPreview already stamps updated_at = now() per write,
-- which is the monotonic key. Apply in the Supabase SQL editor (same as 0001–0003).

create or replace function public.game_previews_guard_monotonic()
returns trigger
language plpgsql
as $$
begin
  -- Keep the existing row when the incoming write is not strictly newer.
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists game_previews_monotonic on public.game_previews;
create trigger game_previews_monotonic
  before update on public.game_previews
  for each row
  execute function public.game_previews_guard_monotonic();
