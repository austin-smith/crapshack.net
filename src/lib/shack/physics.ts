import type RAPIER from '@dimforge/rapier3d-compat';

// Rapier packs a collider's own groups into the top 16 bits and the groups
// it will touch into the bottom 16.
export const GROUP_ISLAND = 0x0001;
export const GROUP_JUNK = 0x0002;
export const GROUP_RESIDENT = 0x0004;

export function groups(membership: number, filter: number): number {
	return (membership << 16) | filter;
}

export const ISLAND_GROUPS = groups(GROUP_ISLAND, 0xffff);
export const JUNK_GROUPS = groups(GROUP_JUNK, GROUP_ISLAND | GROUP_JUNK | GROUP_RESIDENT);
export const RESIDENT_GROUPS = groups(GROUP_RESIDENT, GROUP_ISLAND | GROUP_JUNK | GROUP_RESIDENT);
// A resident squeezing into a tight spot walks through junk for a moment.
export const SQUEEZING_GROUPS = groups(GROUP_RESIDENT, GROUP_ISLAND | GROUP_RESIDENT);

// Queries that only see the island and junk, never residents.
export const SOLID_QUERY = groups(GROUP_JUNK, GROUP_ISLAND | GROUP_JUNK);
// Queries that see everything, for picking things under the pointer.
export const ANY_QUERY = groups(GROUP_JUNK | GROUP_RESIDENT, GROUP_ISLAND | GROUP_JUNK | GROUP_RESIDENT);

export const GRAVITY = -12;

export type Rapier = typeof RAPIER;
