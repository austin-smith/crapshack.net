import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ISLAND_RADIUS } from './island';
import { SOLID_QUERY } from './physics';
import { WALK_GRID } from './navigation';
import { RESIDENT_CENTRE_HEIGHT, RESIDENT_HALF_HEIGHT, RESIDENT_RADIUS } from './residents';

// How covered a standing spot is, from 0 to 1 each.
export type Cover = { roof: number; wall: number };

// What tonight's weather asks of a spot for it to count as safe.
export type Needs = { wall: boolean };

export type Spot = { at: THREE.Vector3; cover: Cover; safe: boolean; score: number };

const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
// Roof rays fan out over roughly a resident's shoulders. All of them have
// to find a roof for a spot to count as covered.
const ROOF_RAYS = [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22], [0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]];
const ROOF_PROBE = new RAPIER.Cuboid(0.23, 0.005, 0.23);

// Room to stand at `ground`: nothing solid where a resident's body would be.
export function clearAt(world: RAPIER.World, ground: THREE.Vector3): boolean {
	let blocked = false;
	world.intersectionsWithShape(
		{ x: ground.x, y: ground.y + RESIDENT_CENTRE_HEIGHT + 0.045, z: ground.z },
		{ x: 0, y: 0, z: 0, w: 1 },
		new RAPIER.Capsule(RESIDENT_HALF_HEIGHT, RESIDENT_RADIUS + 0.035),
		() => {
			blocked = true;
			return false;
		},
		undefined,
		SOLID_QUERY,
	);
	return !blocked;
}

// The floor at x, z: bare ground or something low enough to step onto.
export function groundAt(world: RAPIER.World, x: number, z: number): THREE.Vector3 | null {
	const hit = world.castRay(new RAPIER.Ray({ x, y: 0.55, z }, { x: 0, y: -1, z: 0 }), 1, true, undefined, SOLID_QUERY);
	if (!hit || hit.timeOfImpact < 0.02) return null;
	return new THREE.Vector3(x, 0.55 - hit.timeOfImpact, z);
}

// Rain comes down along `rainDirection` and wind blows in from `windFrom`.
export function coverAt(world: RAPIER.World, at: THREE.Vector3, rainDirection: THREE.Vector3, windFrom: THREE.Vector3): Cover {
	let roof = 0;
	const upward = { x: -rainDirection.x, y: -rainDirection.y, z: -rainDirection.z };
	// Most of the island is open sky. One flat probe as wide as the spread of
	// rays below rules that out in a single query; if it hits nothing, none
	// of the rays could have.
	const overhead = world.castShape({ x: at.x, y: at.y + 0.7, z: at.z }, NO_TURN, upward, ROOF_PROBE, 0, 9, true, undefined, SOLID_QUERY);
	if (overhead) {
		for (const [dx, dz] of ROOF_RAYS) {
			const origin = { x: at.x + dx, y: at.y + 0.7, z: at.z + dz };
			if (world.castRay(new RAPIER.Ray(origin, upward), 9, true, undefined, SOLID_QUERY)) roof += 1;
		}
	}
	let wall = 0;
	const across = { x: windFrom.x, y: 0, z: windFrom.z };
	for (const height of [0.14, 0.34, 0.54]) {
		const origin = { x: at.x, y: at.y + height, z: at.z };
		if (world.castRay(new RAPIER.Ray(origin, across), 2.4, true, undefined, SOLID_QUERY)) wall += 1;
	}
	return { roof: roof / ROOF_RAYS.length, wall: wall / 3 };
}

export function isSafe(cover: Cover, needs: Needs): boolean {
	return cover.roof === 1 && (!needs.wall || cover.wall === 1);
}

// Every standing spot on the island, best first. A safe spot always beats
// an unsafe one; after that, more cover is better.
export function findSpots(
	world: RAPIER.World,
	contains: (x: number, z: number, margin: number) => boolean,
	rainDirection: THREE.Vector3,
	windFrom: THREE.Vector3,
	needs: Needs,
): Spot[] {
	const spots: Spot[] = [];
	const step = WALK_GRID;
	for (let x = -ISLAND_RADIUS; x <= ISLAND_RADIUS; x += step) {
		for (let z = -ISLAND_RADIUS; z <= ISLAND_RADIUS; z += step) {
			if (!contains(x, z, 0.55)) continue;
			const ground = groundAt(world, x, z);
			if (!ground || !clearAt(world, ground)) continue;
			const cover = coverAt(world, ground, rainDirection, windFrom);
			const safe = isSafe(cover, needs);
			spots.push({ at: ground, cover, safe, score: (safe ? 1 : 0) + cover.roof * 0.62 + cover.wall * 0.38 });
		}
	}
	return spots.sort((a, b) => b.score - a.score);
}

// The best spots that are far enough apart for one resident each.
export function spreadSpots(spots: Spot[], spacing: number): Spot[] {
	const kept: Spot[] = [];
	for (const spot of spots) {
		if (kept.every((other) => other.at.distanceTo(spot.at) >= spacing)) kept.push(spot);
	}
	return kept;
}
