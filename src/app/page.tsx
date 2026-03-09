import Link from 'next/link';
import type { ComponentType } from 'react';
import { ArrowRight, Calendar, Newspaper, Sparkles, Tv, Trophy, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeroCTA } from '@/components/landing/hero-cta';

// ─── Feature cards ────────────────────────────────────────────────────────────

interface Feature {
  icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  title: string;
  description: string;
  href?: string;
  cta?: string;
}

const FEATURES: Feature[] = [
  {
    icon: Calendar,
    color: 'text-indigo-400',
    bg: 'bg-indigo-900/30',
    title: 'Never Miss a Game',
    description:
      'Upcoming fixtures for all your teams in one feed — start times in your timezone, venue details, and broadcast info front and centre.',
    href: '/schedule',
    cta: 'View schedule',
  },
  {
    icon: Tv,
    color: 'text-sky-400',
    bg: 'bg-sky-900/30',
    title: 'Where to Watch',
    description:
      'TV channels and streaming platforms for every fixture — so you always know where to tune in before the game starts.',
  },
  {
    icon: Trophy,
    color: 'text-amber-400',
    bg: 'bg-amber-900/30',
    title: 'Recent Form',
    description:
      'Last five results at a glance. See the win/loss run, scores, and home/away splits heading into each fixture.',
  },
  {
    icon: Sparkles,
    color: 'text-violet-400',
    bg: 'bg-violet-900/30',
    title: 'Match Context',
    description:
      'Expand any upcoming fixture for key team news, form, and changes that could influence the result.',
  },
  {
    icon: Newspaper,
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/30',
    title: 'Latest News',
    description:
      'Breaking news, injury updates, and post-match analysis — summarised so you get the key points without the noise.',
  },
  {
    icon: Zap,
    color: 'text-red-400',
    bg: 'bg-red-900/30',
    title: 'Multi-Sport',
    description:
      'AFL, NRL, EPL, NBA, and more — all under one roof. Add or remove teams at any time from the Teams menu.',
  },
];

// ─── League badges ─────────────────────────────────────────────────────────────

const LEAGUES = [
  { name: 'AFL',         icon: '🏉' },
  { name: 'NRL',         icon: '🏉' },
  { name: 'Super Rugby', icon: '🏉' },
  { name: 'EPL',         icon: '⚽' },
  { name: 'NBA',         icon: '🏀' },
  { name: 'NFL',         icon: '🏈' },
  { name: 'MLB',         icon: '⚾' },
  { name: 'NHL',         icon: '🏒' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <section className="hero-gradient relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute top-20 right-[15%] w-72 h-72 rounded-full bg-indigo-600/10 blur-3xl" />
          <div className="absolute bottom-10 left-[5%] w-56 h-56 rounded-full bg-cyan-600/8 blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 py-28 sm:py-40 text-center">
          {/* Pill label */}
          <div className="inline-flex items-center gap-2 bg-white/6 border border-white/14 backdrop-blur-sm rounded-full px-3.5 py-1.5 mb-8">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-indigo-300 tracking-wide">SportHouse</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.05] mb-6">
            Your teams. In one place.
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
              That&apos;s SportHouse.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto leading-relaxed mb-10">
            Pick your teams and get a personalised schedule — upcoming fixtures, broadcast info, and match
            context for every game across AFL, NRL, EPL, and more.
          </p>

          {/* Smart CTA — shows "Go to My Schedule" for returning users */}
          <HeroCTA />
        </div>
      </section>

      {/* ── League strip ── */}
      <section className="border-y border-white/8 bg-white/3">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-center gap-2 flex-wrap">
          <span className="text-xs text-white/30 font-medium mr-2 uppercase tracking-widest">Supported leagues</span>
          {LEAGUES.map(l => (
            <span
              key={l.name}
              className="inline-flex items-center gap-1.5 bg-white/8 border border-white/12 rounded-lg px-3 py-1.5 text-sm font-semibold text-white/65"
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
            Every whistle in one feed. Absolutely SportHouse.
          </h2>
          <p className="text-white/55 max-w-xl mx-auto">
            A clean, personalised view of what matters — when games are on, where to watch, and how your team is travelling.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, color, bg, title, description, href, cta }) => (
            <div
              key={title}
              className="glass rounded-3xl p-6 hover:border-white/20 transition-colors flex flex-col float-hover"
            >
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${bg} mb-4`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <h3 className="text-base font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-white/55 leading-relaxed flex-1">{description}</p>
              {href && cta && (
                <Link href={href} className="mt-4 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors self-start">
                  {cta} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-white/8 bg-white/3">
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
            Grab life by the ball.
          </h2>
          <p className="text-white/55 mb-8 text-lg">
            Pick your teams and your personalised fixture list is ready in seconds. No account required.
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
      <footer className="border-t border-white/8 bg-black/25">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/30">
          <p>© {new Date().getFullYear()} SportHouse. Built for fans.</p>
          <p>Fixtures &amp; schedules for entertainment purposes only.</p>
        </div>
      </footer>
    </div>
  );
}
