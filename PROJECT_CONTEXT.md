# SportHouse — Project Context

> A living architecture reference for SportHouse. Complements `CLAUDE.md` (agent-facing
> build/run instructions). This doc is the "why and how it fits together" overview plus a
> running log of decisions, the next build, and known limitations.
>
> Last updated: 2026-06-01

---

## 1. What it is

SportHouse is a personalized sports dashboard. A user picks the teams they follow (across
AFL, NRL, EPL, Super Rugby, Test Rugby, F1, BBL, international cricket, plus mock-only
NBA/NHL/MLB), and the app builds a tailored feed of fixtures, results, standings, news, and
AI match previews.

It began as a localStorage-only MVP with deterministic mock data and has since grown a real
backend layer: Next.js API routes proxying free public sports APIs (ESPN, Squiggle), AI
previews via Anthropic Claude, and a Supabase identity/persistence layer with **real login
(shipped, live in prod)**.

---

## 2. Stack

- **Next.js 14** (App Router) + **TypeScript**
- **TailwindCSS v3** — custom "glass / obsidian" dark design system
- **lucide-react** — icon set
- **Supabase** — Postgres + Auth. Holds the per-identity followed-teams row (`user_prefs`,
  RLS-protected). Auth: **anonymous identities** (zero-friction default) + **real login via
  Google OAuth and email magic-link** (`@supabase/ssr`, cookie sessions).
- **localStorage** — synchronous read-through cache for the active identity's followed teams
  (Supabase is the durable source of truth).
- **API routes** — thin server layer: fetch upstream sports APIs, normalize to internal
  types, cache, serve.
- **AI text** — Anthropic Claude (**Haiku 4.5** by default) via `@anthropic-ai/sdk` in the
  `ai-preview` / `ai-review` routes; model configurable via `ANTHROPIC_AI_MODEL`
  (`src/lib/ai-model.ts`).
- Dev server runs on **http://localhost:3001**.

### Commands
```bash
npm run dev       # dev server at :3001 (hot reload)
npm run build     # production build (also type-checks)
npm start         # serve production build
npx tsc --noEmit  # type-check only
```

**Baseline health:** `tsc --noEmit` and `npm run build` both exit 0 on `main`.

---

## 3. Directory structure

```
src/
  middleware.ts               — Phase-2 session REFRESH (@supabase/ssr); refresh-only, never
                                mints anon server-side; matcher excludes static assets
  app/
    page.tsx                  — Landing page (server component)
    onboarding/page.tsx       — Team selection wizard (client, 2-step)
    dashboard/page.tsx        — Personalized per-team feed (client)
    schedule/page.tsx         — Fixtures timeline + calendar + league browse (client)
    results/page.tsx          — Past results feed (client)
    layout.tsx                — Root layout (Inter font + Navbar + <PrefsSync/>)
    error.tsx                 — Error boundary
    globals.css               — Tailwind base + glass utilities + keyframes
    auth/callback/route.ts    — OAuth/magic-link PKCE exchangeCodeForSession → redirect /schedule
    api/
      fixtures/route.ts       — Upcoming fixtures for a followed team
      results/route.ts        — Past results for a followed team
      league-fixtures/route.ts— All fixtures for a whole competition (league browse)
      standings/route.ts      — League tables
      news/route.ts           — Team news headlines
      match-stats/route.ts    — Per-match statistics (typed against the lib/espn ESPN interfaces)
      preview/route.ts        — Match preview data assembly
      ai-preview/route.ts     — AI match-preview text (PUBLIC/UNAUTH — gating is the next build)
      ai-review/route.ts      — AI post-match review text (PUBLIC/UNAUTH — gating is the next build)
      weather/route.ts        — Venue weather for fixtures
  components/
    ui/                       — button, card, badge, input, skeleton, team-badge, empty-state
    layout/navbar.tsx         — Fixed top navbar; active-link detection; mounts <AccountMenu/>
    auth/auth-modal.tsx       — Glass sign-in modal (Google + email magic-link), portaled to <body>
    auth/account-menu.tsx     — Navbar account entry: "Sign in" pill ↔ email + Sign out
    landing/hero-cta.tsx
    onboarding/team-selector-card.tsx
    dashboard/                — team-feed-card, game-card, news-item, recent-form
    schedule/                 — next-game-hero, schedule-calendar, game-expand-panel,
                                league-table, f1-starting-grid, sport-ball
    results/result-expand-panel.tsx
    providers/prefs-sync.tsx  — invisible auth-state wiring: serialized per-identity reload on
                                INITIAL_SESSION/SIGNED_IN; guest restore + re-anon on SIGNED_OUT
  lib/
    teams.ts                  — LEAGUES + TEAMS (160+ teams, colors, metadata) + REAL_DATA_LEAGUES
    team-logos.ts             — TEAM_LOGOS (logo URLs) + TEAM_LOGO_FILTERS (CSS filters)
    espn.ts                   — shared ESPN/Squiggle helpers + ESPN response interfaces (typing pilot)
    afl.ts                    — AFL Squiggle-name map + team table derived from teams.ts/team-logos.ts
    ai-model.ts               — AI_MODEL constant (ANTHROPIC_AI_MODEL env, default Haiku 4.5)
    preview-prompt.ts         — shared AI-preview prompt assembly (used by route AND the eval)
    mock-data.ts              — Deterministic mock generators (seed = team ID)
    auth.ts                   — client auth: continueWithGoogle/continueWithEmail (sign-in only,
                                no linkIdentity), getAuthState, signOutToAnon, callbackUrl
    user-prefs.ts             — followed-teams store ('use client'): synchronous localStorage cache
                                + per-identity Supabase row; reconcileActiveIdentity (reload-on-
                                identity-change), restoreGuestSession (sign-out), usePrefsVersion,
                                GUEST_BACKUP + active-identity markers
    supabase/client.ts        — SSR browser client (@supabase/ssr, dynamically imported)
    supabase/server.ts        — read-only SSR server client (Server Components)
    supabase/middleware.ts    — writable SSR client for middleware/route-handler cookie writes
    utils.ts                  — cn(), date/timezone helpers, seededRandom(), contrastColor(), …
    f1-data.ts                — F1 calendar, country→abbr, grid data
    english-football-divisions.ts — EPL/EFL division metadata
  types/index.ts              — All shared TS interfaces
scripts/
  eval-previews.ts            — DEV-ONLY model-comparison harness (not built/bundled)
supabase/
  migrations/0001_user_prefs.sql — user_prefs table + RLS (each user sees only their own row)
```

---

## 4. Core data flow

```
Auth identity (anon or signed-in) ─owns─▶ user_prefs row (Supabase, RLS) ◀─sync─ localStorage cache
                                                                                      │
Onboarding ─saveFollowedTeams()─▶ writes localStorage + CURRENT identity's row        │ getFollowedTeams()
                                                                                      ▼
                                       Dashboard / Schedule / Results ─per-team fetch─▶ /api/* ─▶ ESPN/Squiggle/AI
```

- **localStorage is a synchronous read-through cache** for the *active identity*; Supabase is
  the durable source of truth. Reads stay synchronous (no loading flash); writes go to
  localStorage immediately then push to the current identity's row.
- `<PrefsSync/>` (root layout) drives the cache off `onAuthStateChange` — see §7.
- API routes normalize every upstream response into `types/index.ts` so the display layer
  never sees raw ESPN/Squiggle shapes. Leagues without a real backend use deterministic mock
  data keyed by `seededRandom(teamId)`.
- Pages re-read followed teams without a reload via `usePrefsVersion()` (a counter bumped on
  the `PREFS_UPDATED_EVENT` cache-change event); schedule/results reset their fetch
  accumulators when it changes.

---

## 5. Real data sources (live)

| League        | Fixtures / Results            | Standings                          | News / Extras                |
|---------------|-------------------------------|------------------------------------|------------------------------|
| AFL           | Squiggle `?q=games;year=YEAR` | Squiggle `?q=standings`            | Squiggle `?q=tips;game=ID`   |
| NRL           | ESPN rugby-league scoreboard  | ESPN v2 rugby-league standings     | ESPN team news               |
| EPL           | ESPN soccer scoreboard (5 comps fan-out) | ESPN v2 soccer standings | ESPN team news               |
| Super Rugby   | ESPN                          | ESPN                               | ESPN                         |
| Test Rugby    | ESPN                          | —                                  | —                            |
| F1            | ESPN / f1-data                | ESPN / f1-data                     | grid data                    |
| BBL / Cricket Int | ESPN cricket              | —                                  | —                            |
| **NBA/NHL/MLB** | **mock-data.ts**            | mock                               | mock                         |

- **AFL/Squiggle matches by exact team name.** All 18 names verified against
  `https://api.squiggle.com.au/?q=teams`; `afl-giants` = **"Greater Western Sydney"** (was
  wrongly "GWS Giants" → returned nothing; fixed this cycle).
- **ESPN public API** — no key; routes fan out across competitions for EPL.
- Caching: routes set `Cache-Control: public, max-age=300, stale-while-revalidate=3600` and
  `next: { revalidate }` on upstream fetches.
- **AI previews/reviews are *generated*, not fetched** (Claude Haiku 4.5), then cached.

---

## 6. Design system / UI conventions

- **Obsidian base** (`#080809`) with layered radial-gradient washes in `body` (globals.css).
  Left wash is team-adaptive via `--bg-left-color`.
- **Glass surfaces:** `.glass`, `.glass-strong`, `.glass-hero` — translucent white + backdrop
  blur + cool-amethyst borders. (Note: a `backdrop-filter` ancestor becomes the containing
  block for `position:fixed` descendants — the auth modal is `createPortal`ed to `<body>` to
  escape the navbar's blur for correct full-screen centering.)
- **Team theming:** each team's `primaryColor`/`secondaryColor` drives borders/glows/tints
  **inline via `style`** (no CSS-in-JS).
- **Color convention:** newer pages (schedule, results) use `white/xx` opacity tokens; the
  dashboard still uses the older `zinc-*` palette (see §10).
- **Animations:** `drift`, `drift-slow`, `pulse-ring`, `slideDown`; `float-hover`;
  `smoothScrollTo()`. `prefers-reduced-motion` collapses these to ~0ms at their final frame.

---

## 7. Auth & persistence

### Phase 1 — foundation (live)
Anonymous Supabase identity + RLS. Every visitor gets a real `auth.uid()` (minted client-side
on first load); their followed teams persist to a per-identity `user_prefs` row behind the
unchanged synchronous `user-prefs.ts` interface. Degrades to localStorage-only when Supabase
env vars are unset.

### Phase 2 — real login (SHIPPED, live in prod)
Real login via **Google OAuth** and **email magic-link** — `signInWithOAuth` /
`signInWithOtp`, **not `linkIdentity`**. Server session plumbing: `middleware.ts` refreshes
the cookie session (refresh-only — never mints anon server-side), `auth/callback/route.ts`
does the PKCE `exchangeCodeForSession`.

**TWO INDEPENDENT TEAM SPACES** (the defining model):
- **Guest (anonymous):** device-local picks, zero-friction, no forced login, no gated content.
- **Account (signed-in):** the user's team list in Supabase, **synced across devices**.

The active followed-teams cache is **owned by the current identity** and **RELOADED (replace,
never merge)** on any auth change (`reconcileActiveIdentity` in `user-prefs.ts`, serialized in
`<PrefsSync/>` via `reconcileInFlight` to absorb the `INITIAL_SESSION`+`SIGNED_IN` double-fire):
- **Sign in →** LOAD the account's row into the cache (empty account → empty list).
- **Sign out →** RESTORE the device-local guest picks (`restoreGuestSession`) + re-mint a fresh
  anon session.
- Each identity writes **only its own** `user_prefs` row — **no cross-identity push**, so one
  identity's set can never clobber another's.

**No anon→account merge.** An earlier iteration merged guest picks into the account on sign-in;
it required a `linkIdentity` conversion that hit `identity_already_exists` and a race-prone
cross-identity reconcile that could clobber/blank rows. We **removed the merge**: cross-device
sync is preserved (the real feature); one-time guest→account carryover is dropped as a
deliberate simplification. Trade-off: signing in doesn't preserve the anon UUID (the anon row
is orphaned — see §10).

**UI:** navbar shows a "Sign in to sync across devices" pill when anonymous, or the account
email + Sign out when signed in (reacts to auth changes with no reload). Sign-in is a glass
modal, opt-in only.

---

## 8. Key decisions & gotchas

- **OAuth/magic-link `redirectTo` MUST stay query-less** (`${origin}/auth/callback`, no
  `?next=`). Supabase matches `redirectTo` against its allow-list by **exact URL**; a query
  string fails to match and silently **falls back to the Site URL** (prod domain), bouncing
  localhost/preview sign-ins away unauthenticated. The post-sign-in landing (`/schedule`) is
  chosen server-side in the callback, not carried in the URL.
- **Supabase URL config:** Site URL = prod domain. Redirect allow-list = `/auth/callback` for
  **localhost:3001 + prod + the preview wildcard** (`https://*-<scope>.vercel.app/auth/callback`).
- **Sign-in, never link:** using `signInWithOAuth`/`signInWithOtp` (not `linkIdentity`) means
  the `identity_already_exists` class cannot occur and new/existing accounts share one path.
  ("Allow manual linking" in Supabase is now irrelevant.)
- **AI cost control — Haiku over a token counter.** Switched to Haiku 4.5 (~3× cheaper) and
  decided AGAINST an app-side daily token-budget counter (serverless has no shared state).
  Rely on the Anthropic **Console spend cap** + Haiku + eventual pre-generation. *(Cap can't be
  verified from code — confirm in the Console.)*
- **Prompt caching deferred** — marking the ~9k-token preview system prompt with `cache_control`
  works, but under sparse on-demand traffic the ~5-min cache is usually cold and net-negative;
  it becomes a ~90% input-cost win under batch pre-generation (folded into §11).
- **One Supabase project for prod + local** (for now) — local/test writes share the prod DB.
  Consider a separate prod project later.

---

## 9. Next build — AI-route gating (PR 2)

**The documented next step.** `api/ai-preview` and `api/ai-review` are currently **public and
unauthenticated** → cost exposure on paid Claude calls.

- **Plan:** gate both behind **ANY valid session** (anonymous sessions included — every real
  browser already holds one, so zero-friction UX is preserved), enforced **server-side** using
  the Phase-2 middleware/SSR session infra. Reject session-less callers (no Supabase auth
  cookie — e.g. raw scripted requests) with `401` **before** any paid generation. Use
  `getUser()` (revalidates the JWT), not `getSession()`.
- **`is_anonymous` claim** = the lever for future tiering (e.g. permanent users get higher
  quotas / review regeneration). Phase 2 only checks "is there a user."
- **Interim manual protection (confirm in place):** Anthropic **spend cap** + a **Vercel WAF
  rate-limit** on the two AI routes.

---

## 10. Known limitations / outstanding setup

- **Prod email magic-link sign-in is disabled** — custom SMTP is not configured in Supabase,
  so the email login option doesn't work on the live site (Google OAuth covers prod sign-in).
  Tracked as a low-priority build task — see §11.
- **Orphan anonymous `user_prefs` rows accumulate** — signing in starts a separate account
  identity (no conversion), so each anon row is abandoned; cross-device sign-ins also leave
  throwaway anon rows. Cleanup deferred — run Supabase's orphaned-anonymous-user SQL via
  pg_cron on a schedule. Revisit at scale.
- **NRL fetch-cache overflow** — the rugby-league scoreboard payload (~3.5–6.2 MB) exceeds
  Next's 2 MB fetch-cache limit (`Failed to set Next.js data cache`), so NRL fixtures/results
  aren't cached and ESPN is refetched each load. Fix: narrow the date window/limit, trim the
  payload before caching, or use a custom cache for NRL.
- **International cricket coverage** — `cricket_int` fixtures are series-ID-driven
  (`CRICKET_INT_TEAM_SERIES`); only `int-aus` has configured tours, so other national teams
  show little until ESPN series IDs are added as bilateral tours are announced. Data-coverage
  limitation, **not** a mapping bug (the team→ESPN-name maps are correct).
- **AI routes 500 on non-JSON model output** — `callClaude`/`generateReview` `JSON.parse` the
  model's text; a conversational/malformed reply throws → 500 → "Preview unavailable". Fix via
  tool-use / response schema / assistant-prefill (`{`), not a retry hack.
- **ESPN `as any` rollout** — the `match-stats` typing pilot proved the pattern; ~270 casts
  remain across the larger routes (`fixtures`/`results`/`standings`/`league-fixtures`/`preview`).
  Roll out to the less-defensive ones first.
- **Dashboard palette** — still legacy `zinc-*` vs the app's `white/glass` system; unification
  pass wanted.
- **Navbar account avatar `<img>` → `next/image`** (`navbar.tsx`) — cosmetic lint.
- **Large files to watch** (navigability, not bugs): `preview/route.ts` ~1.6k ·
  `game-expand-panel.tsx` ~1.4k · `schedule/page.tsx` ~1.4k · `fixtures/route.ts` ~1.3k.

---

## 11. Roadmap (after AI-route gating)

1. **AI-route gating (PR 2)** — §9. The immediate next build.
2. **Design / QoL pass** — fold in the cosmetic debt (dashboard palette unification, navbar
   `<img>`→`next/image`, etc.).
3. **Local LLM pre-generation on the Mac mini** *(exploratory "fun build")* — pre-generate
   previews/reviews on the always-on Mac mini and have Vercel read them from a shared store,
   instead of (or alongside) the Anthropic API. Pairs with prompt-caching economics (§8).
4. **More real leagues** — NBA/NHL/MLB via official APIs to replace their mock data.

- **[LOW PRIORITY] Configure custom SMTP in Supabase to enable email magic-link sign-in in
  production.** Currently unset, so the email login option doesn't work on the live site (§10).
  Google OAuth covers prod sign-in, so this is only needed for users without a Google account
  or as a fallback method. Work involved: pick an email provider (Resend / SendGrid / Postmark /
  Amazon SES), add its SMTP credentials under Supabase Auth → SMTP settings, and verify a
  sending domain. **No app code changes — it's a config task.**

---

## 12. Resolved this cycle (done — not carried as debt)

- **Auth Phase 2 shipped** — Google OAuth + email magic-link; two-team-spaces model (no merge);
  query-less redirect; navbar account state + sign-out; modal portaled to body. Live in prod.
- **AFL GWS mapping fixed** — `afl-giants` → "Greater Western Sydney" (fixtures + results now
  return data).
- **My Teams pill-row stretch fixed** — `min-w-0` on the schedule/results left grid column so
  the row scrolls within its track instead of stretching the page at high team counts.

---

## 13. Agent notes / preferences (from memory)

- **AI previews:** don't acknowledge small sample size / early-season hedging — redirect to
  useful content instead.
- **AI preview cache:** two cache layers (server `unstable_cache` + `localStorage`) must
  **both** be bumped when the system prompt changes.
