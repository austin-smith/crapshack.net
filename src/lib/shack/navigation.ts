import * as THREE from 'three';
import type { Spot } from './shelter';

// The spacing of the standing spots residents walk between.
export const WALK_GRID = 0.2;
// How far from where someone stands a spot can be and still count as a way out.
const REACH = 0.75;
// The biggest step up or down a resident will take between spots.
const STEP_UP = 0.16;

const key = (at: THREE.Vector3) => `${Math.round(at.x / WALK_GRID)},${Math.round(at.z / WALK_GRID)}`;

export type ShelterPlan = { spot: Spot; route: THREE.Vector3[] };

// Finds each resident a spot and a way to walk there, over the same clear
// standing spots the shelter preview shows. Residents only step to the four
// neighbouring spots, so a route never cuts diagonally through the corner of
// something solid, and a sealed room is never offered as shelter.
export function planShelter(spots: Spot[], starts: THREE.Vector3[], spacing: number): (ShelterPlan | null)[] {
	const cells = new Map(spots.map((spot) => [key(spot.at), spot]));
	const claimed: THREE.Vector3[] = [];
	return starts.map((start) => {
		// Every spot within reach is a way out, nearest first. Starting from
		// only the nearest one can strand someone in a pocket beside a plank.
		const entries = spots
			.map((spot) => ({ spot, distance: Math.hypot(start.x - spot.at.x, start.z - spot.at.z) }))
			.filter(({ distance }) => distance < REACH)
			.sort((a, b) => a.distance - b.distance)
			.map(({ spot }) => spot);
		if (entries.length === 0) return null;

		const queue = [...entries];
		const previous = new Map<string, Spot | null>(entries.map((spot) => [key(spot.at), null]));
		for (let index = 0; index < queue.length; index += 1) {
			const spot = queue[index];
			const x = Math.round(spot.at.x / WALK_GRID);
			const z = Math.round(spot.at.z / WALK_GRID);
			for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const id = `${x + dx},${z + dz}`;
				const next = cells.get(id);
				if (!next || previous.has(id) || Math.abs(next.at.y - spot.at.y) > STEP_UP) continue;
				// Someone already settling somewhere is in the way too, but a
				// person starting next to them can still step away.
				const crowded = claimed.some((at) => next.at.distanceTo(at) < 0.39 && next.at.distanceTo(at) < spot.at.distanceTo(at));
				if (crowded) continue;
				previous.set(id, spot);
				queue.push(next);
			}
		}

		// The queue is in walking order, so a spot's index is how far away it is.
		const candidates = queue
			.map((spot, distance) => ({ spot, distance }))
			.filter(({ spot }) => spot.cover.roof > 0 && claimed.every((at) => at.distanceTo(spot.at) >= spacing));
		// Take the edge of a covered patch before its middle. Standing in the
		// middle of a small roof can use up two people's room.
		const ranked = candidates.map((candidate) => ({
			...candidate,
			neighbours: candidates.filter(({ spot }) =>
				spot.safe === candidate.spot.safe
				&& spot.cover.roof === candidate.spot.cover.roof
				&& spot.at.distanceTo(candidate.spot.at) < spacing).length,
		}));
		ranked.sort((a, b) =>
			Number(b.spot.safe) - Number(a.spot.safe)
			|| b.spot.cover.roof - a.spot.cover.roof
			|| a.neighbours - b.neighbours
			|| a.distance - b.distance);
		const best = ranked[0]?.spot;
		if (!best) return null;
		claimed.push(best.at);

		const route: THREE.Vector3[] = [];
		let step: Spot | null = best;
		while (step) {
			route.unshift(step.at.clone());
			step = previous.get(key(step.at)) ?? null;
		}
		// Keep the corners, and walk each straight stretch in one go.
		const corners = route.filter((point, index) => {
			if (index === 0 || index === route.length - 1) return true;
			const before = route[index - 1];
			const after = route[index + 1];
			const turning = Math.abs(before.x - after.x) > 0.01 && Math.abs(before.z - after.z) > 0.01;
			const stepping = Math.abs(point.y - before.y) > 0.01 || Math.abs(point.y - after.y) > 0.01;
			return turning || stepping;
		});
		return { spot: best, route: corners };
	});
}
