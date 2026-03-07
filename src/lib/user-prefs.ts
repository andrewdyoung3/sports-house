'use client';

/**
 * Client-side preferences management via localStorage.
 * Import this only inside 'use client' components or useEffect hooks.
 * Swap out the localStorage calls with Supabase / API calls when adding auth.
 */

import type { Team } from '@/types';

const STORAGE_KEY = 'sports-house:teams';

function isTeam(v: unknown): v is Team {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).name === 'string' &&
    typeof (v as Record<string, unknown>).shortName === 'string' &&
    typeof (v as Record<string, unknown>).abbreviation === 'string' &&
    typeof (v as Record<string, unknown>).league === 'string' &&
    typeof (v as Record<string, unknown>).primaryColor === 'string' &&
    typeof (v as Record<string, unknown>).secondaryColor === 'string' &&
    typeof (v as Record<string, unknown>).venue === 'string'
  );
}

export function getFollowedTeams(): Team[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(isTeam);
  } catch {
    return [];
  }
}

export function saveFollowedTeams(teams: Team[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
}

export function isFollowing(teamId: string): boolean {
  return getFollowedTeams().some(t => t.id === teamId);
}

/** Toggle a team and return the updated array. */
export function toggleTeam(team: Team): Team[] {
  const current = getFollowedTeams();
  const exists  = current.some(t => t.id === team.id);
  const updated = exists
    ? current.filter(t => t.id !== team.id)
    : [...current, team];
  saveFollowedTeams(updated);
  return updated;
}

export function clearFollowedTeams(): void {
  localStorage.removeItem(STORAGE_KEY);
}
