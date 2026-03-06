import Link from 'next/link';
import { ArrowRight, Calendar, Newspaper, Sparkles, Tv, Trophy, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Feature cards ────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Calendar,
    color: 'text-indigo-400',
    bg: 'bg-indigo-900/30',
    title: 'Never Miss a Game',
    description:
      'Upcoming schedules for all your teams in one feed — with start times in your timezone, venue details, and real-time countdown.',
  },
  {
    icon: Tv,
    color: 'text-sky-400',
    bg: 'bg-sky-900/30',
    title: 'Where to Watch',
    description:
      'Know exactly where to tune in before every game. TV channels, streaming platforms, and regional availability all in one place.',
  },
  {
    icon: Sparkles,
    color: 'text-violet-400',
    bg: 'bg-violet-900/30',
    title: 'AI Matchup Previews',
    description:
      'Get concise, AI-generated game previews covering recent form, injury reports, head-to-head history, and likely outcomes.',
  },
  {
    icon: Newspaper,
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/30',
    title: 'Latest News',
    description:
      'Breaking news, transfer rumours, and post-match analysis aggregated from top sources — summarised so you get the key points fast.',
  },
  {
    icon: Trophy,
    color: 'text-amber-400',
    bg: 'bg-amber-900/30',
    title: 'Recent Results',
    description:
      'A clear win/loss timeline for every team you follow. See scorelines, opponent details, and home/away splits at a glance.',
  },
  {
    icon: Zap,
    color: 'text-red-400',
    bg: 'bg-red-900/30',
    title: 'Multi-Sport Support',
    description:
      'AFL, NRL, Super Rugby, EPL, NBA, and more — all under one roof. Add or remove teams at any time.',
  },
];

// ─── League badges for the social-proof strip ─────────────────────────────────

const LEAGUES = [
  { name: 'AFL',        icon: '🏉' },
  { name: 'NRL',        icon: '🏉' },
  { name: 'Super Rugby',icon: '🏉' },
  { name: 'Rugby Union',icon: '🏉' },
  { name: 'EPL',        icon: '⚽' },
  { name: 'NBA',        icon: '🏀' },
  { name: 'NFL',        icon: '🏈' },
  { name: 'MLB',        icon: '⚾' },
  { name: 'NHL',        icon: '🏒' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <section className="hero-gradient relative overflow-hidden">
        {/* Decorative blobs */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden
        >
          <div className="absolute top-20 right-[15%] w-72 h-72 rounded-full bg-indigo-600/10 blur-3xl" />
          <div className="absolute bottom-10 left-[5%] w-56 h-56 rounded-full bg-cyan-600/8 blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 py-28 sm:py-40 text-center">
          {/* Pill label */}
          <div className="inline-flex items-center gap-2 bg-indigo-950/80 border border-indigo-700/40 rounded-full px-3.5 py-1.5 mb-8">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-indigo-300 tracking-wide">Introducing Sports House</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.05] mb-6">
            Your teams.
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
              All in one place.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed mb-10">
            Schedules, matchup previews, breaking news, and&nbsp;
            <em className="not-italic text-zinc-300">where to watch</em> info — for every AFL, NRL, Rugby, EPL, and NBA team you follow.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/onboarding">
              <Button size="lg" className="gap-2 w-full sm:w-auto">
                Get Started — Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                View Demo Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── League strip ── */}
      <section className="border-y border-zinc-800 bg-zinc-900/50">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-600 font-medium mr-2 uppercase tracking-widest">Supported leagues</span>
          {LEAGUES.map(l => (
            <span
              key={l.name}
              className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-300"
            >
              <span>{l.icon}</span> {l.name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-6xl mx-auto px-4 py-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            Sports House cuts through the noise to give you a clean, personalised view of what matters to you.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, color, bg, title, description }) => (
            <div
              key={title}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-zinc-700 transition-colors"
            >
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${bg} mb-4`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <h3 className="text-base font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Ready to build your dashboard?
          </h2>
          <p className="text-zinc-400 mb-8 text-lg">
            Select your teams and get your personalised sports feed in under 60 seconds. No account required.
          </p>
          <Link href="/onboarding">
            <Button size="lg" className="gap-2">
              Choose Your Teams
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-zinc-800 bg-zinc-950">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
          <p>© {new Date().getFullYear()} Sports House. Built for fans, by fans.</p>
          <p>Scores &amp; schedules data for entertainment purposes only.</p>
        </div>
      </footer>
    </div>
  );
}
