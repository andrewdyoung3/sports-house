'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/',           label: 'Home',      icon: Home },
  { href: '/dashboard', label: 'Dashboard', icon: Search },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/60">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-sm group-hover:bg-indigo-500 transition-colors">
            SH
          </div>
          <span className="font-bold text-white text-sm tracking-tight hidden sm:block">
            Sports House
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
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:block">{label}</span>
              </Link>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Link
            href="/onboarding"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-all"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:block">Teams</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
