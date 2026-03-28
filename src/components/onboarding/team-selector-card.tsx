'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TeamBadge } from '@/components/ui/team-badge';
import { TEAM_LOGOS } from '@/lib/team-logos';
import { F1_CONSTRUCTOR_LOGOS, isF1ConstructorTeam } from '@/lib/f1-data';
import type { Team } from '@/types';

interface TeamSelectorCardProps {
  team: Team;
  selected: boolean;
  onToggle: (team: Team) => void;
}

export function TeamSelectorCard({ team, selected, onToggle }: TeamSelectorCardProps) {
  const logoUrl = TEAM_LOGOS[team.id];

  return (
    <button
      onClick={() => onToggle(team)}
      className={cn(
        'relative flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-center w-full cursor-pointer group',
        selected
          ? 'border-transparent shadow-lg scale-[1.02]'
          : 'border-white/10 bg-white/5 backdrop-blur-sm hover:border-white/22 hover:bg-white/8',
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
          'absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 text-white z-10',
          selected ? 'opacity-100 scale-100' : 'opacity-0 scale-75',
        )}
        style={{ backgroundColor: team.primaryColor }}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>

      {/* Team crest */}
      <TeamBadge
        logoUrl={logoUrl}
        abbreviation={team.abbreviation}
        primaryColor={team.primaryColor}
        size={72}
        className="rounded-2xl"
        overlayLogoUrl={
          team.league === 'f1' && !isF1ConstructorTeam(team.id)
            ? F1_CONSTRUCTOR_LOGOS[team.division ?? '']
            : undefined
        }
      />

      {/* Name */}
      <div className="min-w-0 w-full">
        <p className={cn(
          'text-sm font-bold leading-tight truncate',
          selected ? 'text-white' : 'text-white/85',
        )}>
          {team.shortName}
        </p>
        <p className={cn(
          'text-xs leading-tight mt-0.5 truncate',
          selected ? 'text-white/70' : 'text-white/40',
        )}>
          {team.league === 'f1'
            ? (isF1ConstructorTeam(team.id) ? team.country : (team.division ?? team.city))
            : team.city
          }
        </p>
      </div>
    </button>
  );
}
