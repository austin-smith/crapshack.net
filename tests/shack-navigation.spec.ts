import { test, expect } from '@playwright/test';
import { Vector3 } from 'three';
import { planShelter } from '../src/lib/shack/navigation';
import type { Spot } from '../src/lib/shack/shelter';

function cell(x: number, z: number, roof = 0, safe = roof === 1): Spot {
	return { at: new Vector3(x, 0, z), cover: { roof, wall: 0 }, safe, score: roof };
}

test('two neighbours use opposite sides of a small roof instead of wasting its centre', () => {
	const spots: Spot[] = [];
	for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
		spots.push(cell(x * .2, z * .2, Math.abs(x) <= 1 && Math.abs(z) <= 1 ? 1 : Math.abs(x) <= 1 && Math.abs(z) <= 2 ? .5 : 0));
	}
	const plans = planShelter(spots, [new Vector3(0, 0, .8), new Vector3(0, 0, -.8)], .46);
	expect(plans.every(plan => plan?.spot.safe)).toBe(true);
	expect(plans[0]!.spot.at.distanceTo(plans[1]!.spot.at)).toBeGreaterThanOrEqual(.46);
});

test('a sealed room is not offered as reachable shelter', () => {
	const plans = planShelter([cell(0, 0), cell(.2, 0), cell(1.2, 0, 1)], [new Vector3()], .46);
	expect(plans).toEqual([null]);
});

test('neighbours still seek the best available cover when no roof is fully safe', () => {
	const plans = planShelter([cell(0, 0), cell(.2, 0, .5, false), cell(.4, 0, .9, false)], [new Vector3()], .46);
	expect(plans[0]?.spot.cover.roof).toBe(.9);
	expect(plans[0]?.spot.safe).toBe(false);
	expect(plans[0]?.route.at(-1)?.x).toBe(.4);
});
