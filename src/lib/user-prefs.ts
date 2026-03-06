'use client';

/**
 * Client-side preferences management via localStorage.
 * Import this only inside 'use client' components or useEffect hooks.
 * Swap out the localStorage calls with Supabase / API calls when adding auth.
 */

import type { Team } from '@/types';

const STORAGE_KEY = 'sports-house:teams';

export function getFollowedTeams(): Team[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Team[];
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
