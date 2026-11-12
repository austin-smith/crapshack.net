/**
 * How wet a surface that soaks (a surface's `soaks`, see ./surfaces) has
 * got, column by column: rain soaks it where it lands, and snow as it melts
 * on it (see ./rain, ./snow). It's the surface's, not the weather's, so
 * through a change of weather it's one soaking, drying the same whatever's
 * wetting it, and drawn once a frame whichever weather draws it.
 */

import { hasGround, pagePoint, type Footing } from './footing';
import type { WeatherSurface } from './surfaces';

interface Soaking {
	/** How soaked each column is, 0 to 1. */
	soaked: Float32Array;
	/** When it was last wetted, ms. */
	wetted: number;
	/** The frames it was last dried and drawn in, and dried by weather that's still falling. */
	dried: number;
	drawn: number;
	tended: number;
}

// How much a second it dries while it's still being wetted, and after.
const DRY = 0.01;
const DRY_AFTER = 0.12;
// Wetted within this long, ms, it's still being wetted; dried by weather
// that's still falling this long ago, ms, that weather's still drying it.
const WETTING = 1000;
const TENDING = 250;
// How far down from the top a soaking goes, CSS px: this far damp, once
// it's DAMP_AT soaked (less, less), and this much more soaked through.
const DAMP = 8;
const DAMP_AT = 0.2;
const DEEP = 90;
// Less soaked than this doesn't show.
const SHOWS = 0.04;

const soakings = new WeakMap<WeatherSurface, Soaking>();

function soakingOf(surface: WeatherSurface): Soaking | undefined {
	if (!surface.soaks) return;
	const columns = surface.ground.length;
	let found = soakings.get(surface);
	if (!found || found.soaked.length !== columns) {
		found = {
			soaked: new Float32Array(columns),
			wetted: Number.NEGATIVE_INFINITY,
			dried: Number.NaN,
			drawn: Number.NaN,
			tended: Number.NEGATIVE_INFINITY,
		};
		soakings.set(surface, found);
	}
	return found;
}

/** Smooth, 0 to 1, along x, and drifting as t goes. */
const ruffle = (x: number, t: number): number =>
	0.5 + 0.3 * Math.sin(x * 1.7 + t) * Math.sin(x * 0.63 - t * 0.7) + 0.2 * Math.sin(x * 2.9 - t * 1.3);

/**
 * Soaks a surface's `column` by `amount`, where it soaks: up to `most`, or
 * if it's wetter than that already, no wetter.
 */
export function soak<T>(footing: Footing<T>, column: number, amount: number, most = 1): void {
	const soaking = soakingOf(footing.surface);
	if (!soaking || column < 0 || column >= soaking.soaked.length) return;
	const { soaked } = soaking;
	soaked[column] = Math.max(soaked[column], Math.min(most, soaked[column] + amount));
	soaking.wetted = performance.now();
}

/**
 * Lets a surface dry for frame `time` (as requestAnimationFrame gives it),
 * if it's not already dried for it, slowly while it's still being wetted.
 * `falling` is whether the weather drying it is still falling. Returns
 * whether that weather should keep going for it: any of it's still soaked
 * enough to show, and, for weather that's stopped, no weather that's still
 * falling is drying it, to see it dry.
 */
export function drying<T>(footing: Footing<T>, time: number, seconds: number, falling: boolean): boolean {
	const soaking = soakings.get(footing.surface);
	if (!soaking) return false;
	const { soaked } = soaking;
	if (falling) soaking.tended = time;
	else if (time - soaking.tended < TENDING) return false;
	if (soaking.dried !== time) {
		soaking.dried = time;
		const amount = (time - soaking.wetted < WETTING ? DRY : DRY_AFTER) * seconds;
		for (let column = 0; column < soaked.length; column++) soaked[column] = Math.max(0, soaked[column] - amount);
	}
	return soaked.some((wetness) => wetness > SHOWS);
}

/**
 * Draws what's soaked on a surface, from its top down, if nothing's drawn
 * it for frame `time` yet: deeper the wetter, with a ragged edge that shifts
 * a little each drawing. `on` is where to draw it.
 */
export function drawSoaked<T>(on: () => CanvasRenderingContext2D, footing: Footing<T>, time: number): void {
	const { soaks } = footing.surface;
	const soaking = soakings.get(footing.surface);
	if (!soaks || !soaking || soaking.drawn === time) return;
	soaking.drawn = time;
	const { soaked } = soaking;
	const context = on();
	context.save();
	context.beginPath();
	for (const part of soaks.parts) {
		context.moveTo(part[0].x, part[0].y);
		for (const point of part) context.lineTo(point.x, point.y);
		context.closePath();
	}
	context.clip();
	context.fillStyle = soaks.color;
	const fill = (from: number, to: number): void => {
		if (to - from < 1) return;
		context.beginPath();
		// From just above its top, for the clip to trim to its edge.
		for (let column = from; column <= to; column++) {
			const top = pagePoint(footing, column, 4 / footing.unitY);
			if (column === from) context.moveTo(top.x, top.y);
			else context.lineTo(top.x, top.y);
		}
		for (let column = to; column >= from; column--) {
			const ragged = 0.75 + ruffle(column * 0.12, footing.drawing * 0.05) * 0.5;
			const wetness = soaked[column];
			const depth = DAMP * Math.min(1, wetness / DAMP_AT) + DEEP * wetness ** 1.4;
			const bottom = pagePoint(footing, column, -(depth * ragged) / footing.unitY);
			context.lineTo(bottom.x, bottom.y);
		}
		context.closePath();
		context.fill();
	};
	let from = -1;
	for (let column = 0; column <= soaked.length; column++) {
		const shows = column < soaked.length && soaked[column] > SHOWS && hasGround(footing, column);
		if (shows && from < 0) from = column;
		if (!shows && from >= 0) {
			fill(from, column - 1);
			from = -1;
		}
	}
	context.restore();
}
