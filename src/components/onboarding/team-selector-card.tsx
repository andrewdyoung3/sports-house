'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Team } from '@/types';

interface TeamSelectorCardProps {
  team: Team;
  selected: boolean;
  onToggle: (team: Team) => void;
}

export function TeamSelectorCard({ team, selected, onToggle }: TeamSelectorCardProps) {
  return (
    <button
      onClick={() => onToggle(team)}
      className={cn(
        'relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 text-center w-full cursor-pointer group',
        selected
          ? 'border-transparent shadow-lg scale-[1.02]'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800/80',
      )}
      style={selected ? {
        background: `linear-gradient(135deg, ${team.primaryColor}22 0%, ${team.primaryColor}11 100%)`,
        borderColor: team.primaryColor,
        boxShadow: `0 0 0 1px ${team.primaryColor}66, 0 4px 20px ${team.primaryColor}22`,
      } : undefined}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${team.name}`}
      aria-pressed={selected}
    >
      {/* Selection checkmark */}
      <div
        className={cn(
          'absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 text-white',
          selected ? 'opacity-100 scale-100' : 'opacity-0 scale-75',
        )}
        style={{ backgroundColor: team.primaryColor }}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>

      {/* Team crest — colored circle with abbreviation */}
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center font-black text-lg tracking-tight transition-all duration-200 shrink-0"
        style={{
          backgroundColor: selected ? team.primaryColor : `${team.primaryColor}22`,
          color: selected ? '#ffffff' : team.primaryColor,
        }}
      >
        {team.abbreviation}
      </div>

      {/* Name */}
      <div className="min-w-0 w-full">
        <p className={cn(
          'text-xs font-bold leading-tight truncate',
          selected ? 'text-white' : 'text-zinc-200',
        )}>
          {team.shortName}
        </p>
        <p className={cn(
          'text-[10px] leading-tight mt-0.5 truncate',
          selected ? 'text-zinc-300' : 'text-zinc-500',
        )}>
          {team.city}
        </p>
      </div>
    </button>
  );
}
