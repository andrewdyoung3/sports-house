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
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-black/25 backdrop-blur-xl border-b border-white/8">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        {/* Logo — links to home (replaces the Home nav item) */}
        <Link href="/" className="flex items-center gap-2 group opacity-90 hover:opacity-100 transition-opacity">
          <img
            src="/icon-mark.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 flex-shrink-0"
          />
          <span className="text-white font-semibold text-lg tracking-tight leading-none hidden sm:block">
            SportHouse
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/8',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:block">{label}</span>
              </Link>
            );
          })}

          {/* Calendar — visible on home, schedule, and results pages on mobile */}
          {(onHome || onSchedule || onResults) && (
            <button
              onClick={openCalendar}
              className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all"
              aria-label="Open calendar"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:block">Calendar</span>
            </button>
          )}
        </div>

        {/* Right side — Teams settings + account */}
        <div className="flex items-center gap-2">
          <Link
            href="/onboarding"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:block">My Teams</span>
          </Link>
          <AccountMenu />
        </div>
      </div>
    </nav>
  );
}
