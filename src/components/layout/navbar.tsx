'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Trophy, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/',         label: 'Home',     icon: Home },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  { href: '/results',  label: 'Results',  icon: Trophy },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-black/25 backdrop-blur-xl border-b border-white/8">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        {/* Logo — SVG icon mark (transparent bg) + white wordmark */}
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
        </div>

        {/* Right side — Teams settings */}
        <div className="flex items-center gap-2">
          <Link
            href="/onboarding"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white/50 hover:text-white hover:bg-white/8 transition-all"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:block">My Teams</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
