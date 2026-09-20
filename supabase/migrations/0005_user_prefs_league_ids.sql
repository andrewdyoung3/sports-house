-- SportHouse — followed COMPETITIONS join the synced prefs row.
--
-- Whole-competition follows (onboarding's "Follow the whole competition", and the
-- schedule's competition-pill star) were device-local only: written to
-- localStorage 'sports-house:leagues' and never pushed anywhere. Followed TEAMS
-- have always been synced here, so the two drifted apart — signing in, switching
-- device, or switching origin silently dropped every competition follow while
-- teams came back intact. F1 is followed as a competition far more often than as
-- a driver, so F1 fans lost their only follow.
--
-- league_ids holds league slugs ('afl', 'f1', 'epl', …), alongside the team slugs
-- already in team_ids. Existing rows default to '{}' — that is correct, not a
-- data loss: those users' competition follows only ever existed on one device,
-- and the next local edit pushes them up.
--
-- Run in Supabase → SQL Editor. Safe to re-run.

alter table public.user_prefs
  add column if not exists league_ids text[] not null default '{}';

-- RLS policies from 0001 are table-wide (auth.uid() = user_id) and already cover
-- the new column — no policy changes needed.
