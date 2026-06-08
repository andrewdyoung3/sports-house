'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { List, Trophy, Settings, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/auth/account-menu';

const NAV_LINKS = [
  { href: '/schedule', label: 'Schedule', icon: List },
  { href: '/results',  label: 'Results',  icon: Trophy },
];

export function Navbar() {
  const pathname   = usePathname();
  const router     = useRouter();
  const onSchedule = pathname === '/schedule';
  const onResults  = pathname === '/results';
  const onHome     = pathname === '/';

  function openCalendar() {
    if (onSchedule || onResults) {
      // Pages with a calendar bottom sheet — trigger it via custom event
      window.dispatchEvent(new CustomEvent('sporthouse:open-calendar'));
    } else {
      // Home page — navigate to schedule and auto-open the calendar there
      router.push('/schedule?cal=1');
    }
  }

  return (
    // Phase B · Step 4 — design header skin over the EXISTING fixed-glass shell.
    // `sh-theme` (default tokens, NO accent override — neutral app-wide chrome) lets the
    // `.sh-*` classes + Hanken wordmark resolve. The fixed positioning, glass/blur bg,
    // border, h-14 height and the body's pt-14 offset are intentionally kept — a fixed
    // header over scrolling content needs its own bg/blur (unlike the design's in-flow,
    // transparent `.sh-header`). `.sh-theme` adds no backdrop-filter, so the auth modal
    // (portaled to <body>) and the absolute account dropdown remain un-trapped.
    <nav className="sh-theme fixed top-0 left-0 right-0 z-50 h-14 bg-black/25 backdrop-blur-xl border-b border-white/8">
      {/* 3-column IN-FLOW grid (1fr · auto · 1fr): equal side columns force the centre
          nav to true viewport-centre and make overlap impossible at any width. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-[30px] h-full grid grid-cols-[1fr_auto_1fr] items-center">

        {/* Brand → home */}
        <Link href="/" className="sh-logo justify-self-start group opacity-90 hover:opacity-100 transition-opacity">
          <img src="/icon-mark.svg" alt="" aria-hidden="true" className="sh-logomark h-8 w-8 flex-shrink-0" />
          <span className="sh-wordmark hidden sm:block">SportHouse</span>
        </Link>

        {/* Centre nav pill — in-flow (position override) in the grid's auto column, so it's
            content-sized and truly centred without the design's absolute positioning. */}
        <div className="sh-nav justify-self-center" style={{ position: 'static', transform: 'none' }}>
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn('sh-nav-tab', pathname === href && 'is-active')}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:block">{label}</span>
            </Link>
          ))}

          {/* Calendar — mobile/tablet only (desktop uses the sidebar calendar) */}
          {(onHome || onSchedule || onResults) && (
            <button onClick={openCalendar} className="sh-nav-tab lg:hidden" aria-label="Open calendar">
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:block">Calendar</span>
            </button>
          )}
        </div>

        {/* Right — My Teams + account control */}
        <div className="flex items-center gap-2 justify-self-end">
          <Link href="/onboarding" className="sh-nav-myteams">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:block">My Teams</span>
          </Link>
          <AccountMenu />
        </div>
      </div>
    </nav>
  );
}
