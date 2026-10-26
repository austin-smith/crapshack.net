/**
 * Where the weather lands, along the bottom of its container: rain fills a
 * puddle that ripples where each drop hits, and snow heaps up where each
 * flake lands, slumping where it gets too steep. Either rises quickly at
 * first, then more slowly as it nears full, and stops there: the puddle
 * level, the drift as lumpy as the snow left it.
 */

import { inSight, watchSight } from './canvas';
import { watchWeatherOccluders, weatherOccluders } from './surfaces';

export type PoolKind = 'rain' | 'snow';

export interface PoolOptions {
	kind: PoolKind;
	/** Multiplies depth and splash, as the particles' own scale does. */
	scale?: number;
	/** How many particles land a second, on average, so the pool fills in its time however heavy the weather. */
	rate: number;
	/** About how long it takes to fill, in seconds. */
	fillSeconds?: number;
	/** sessionStorage key to keep the pool from page to page. */
	persist?: string;
	/** Sits behind the page's weather occluders (see ./surfaces). */
	behind?: boolean;
}

export interface Pool {
	/**
	 * Lands a particle at `x`, a fraction of the container's width. `weight`
	 * is its size against the average: about 1.
	 */
	land: (x: number, weight?: number) => void;
	destroy: () => void;
}

// How deep it gets: the puddle's level, or the drift's on average.
const DEPTH = 30;
// Room above that for waves and splashes, or the drift's heaps and glow.
const HEADROOM = 26;
const FILL_SECONDS: Record<PoolKind, number> = { rain: 50, snow: 120 };
const MAX_PIXEL_RATIO = 2;

// Columns across the pool, in px.
const COLUMN = 3;
// Snow: how wide a flake spreads when it lands, and the steepest a drift
// stands before it slumps.
const SNOW_SPREAD = 10;
const SNOW_SLOPE = 0.6;
// Rain: the ripples, per 1/120s step.
const RIPPLE_SPREAD = 0.12;
const RIPPLE_TENSION = 0.01;
const RIPPLE_DAMPING = 0.05;
const RIPPLE_IMPULSE = 2.2;
// Rain: the chop on its surface, a few waves summed: how far each one's
// crests are apart, px, how fast they come and go, radians a second, and
// how high, px. They grow as it deepens.
const CHOP = [
	{ length: 144, rate: 2.1, height: 1.3 },
	{ length: 69, rate: -3.3, height: 0.8 },
	{ length: 358, rate: 1.2, height: 1.6 },
];
const STEP = 1 / 120;
const GRAVITY = 1400;

// Kept pools are saved as this many samples, each a fraction of full depth.
const SAVED_SAMPLES = 160;

interface Splash {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

interface Saved {
	kind: PoolKind;
	values: number[];
}

/** Stretches or squeezes `values` to `length` samples. */
function resample(values: ArrayLike<number>, length: number): Float32Array<ArrayBuffer> {
	const out = new Float32Array(length);
	if (values.length === 0) return out;
	for (let i = 0; i < length; i++) {
		const at = length === 1 ? 0 : (i / (length - 1)) * (values.length - 1);
		const below = Math.floor(at);
		const above = Math.min(values.length - 1, below + 1);
		out[i] = values[below] + (values[above] - values[below]) * (at - below);
	}
	return out;
}

function readSaved(key: string | undefined, kind: PoolKind): number[] | undefined {
	if (!key) return;
	try {
		const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Saved | null;
		if (saved?.kind !== kind || !Array.isArray(saved.values)) return;
		// A drift's heaps stand over its average depth.
		const most = kind === 'snow' ? 1 + HEADROOM / DEPTH : 1;
		return saved.values.map((value) => Math.min(most, Math.max(0, Number(value) || 0)));
	} catch {
		return;
	}
}

export function createPool(container: HTMLElement, options: PoolOptions): Pool | undefined {
	const { kind, scale = 1, rate, fillSeconds = FILL_SECONDS[kind], persist, behind = false } = options;
	const canvas = document.createElement('canvas');
	canvas.className = 'weather-pool';
	canvas.setAttribute('aria-hidden', 'true');
	const context = canvas.getContext('2d');
	if (!context) return;

	const depth = DEPTH * scale;
	const height = depth + HEADROOM * scale;
	canvas.style.height = `${height}px`;
	container.appendChild(canvas);

	// Snow: roughly the share of the drift each landing fills, for it to be
	// most of the way full after fillSeconds.
	const share = 3 / Math.max(1, rate * fillSeconds);

	let width = 0;
	let ratio = 1;
	// Snow: the drift's height in each column. Rain: each column's ripple,
	// how fast it's moving, and where the surface is, as drawn.
	let heights = new Float32Array(0);
	let ripples = new Float32Array(0);
	let ripplesMoving = new Float32Array(0);
	let tops = new Float32Array(0);
	let level = 0;
	// Seconds the chop has run, from a random start.
	let chopTime = Math.random() * 100;
	const chopPhases = CHOP.map(() => Math.random() * Math.PI * 2);
	const splashes: Splash[] = [];
	let restored = readSaved(persist, kind);
	if (kind === 'rain' && restored) level = (restored[0] ?? 0) * depth;

	/** Traces the top of the pool, smoothly, through each column's height. */
	const traceSurface = (top: (i: number) => number, columns: number): void => {
		const spacing = width / (columns - 1);
		context.beginPath();
		context.moveTo(0, top(0));
		for (let i = 1; i < columns - 1; i++) {
			context.quadraticCurveTo(i * spacing, top(i), (i + 0.5) * spacing, (top(i) + top(i + 1)) / 2);
		}
		context.lineTo(width, top(columns - 1));
	};

	const drawSnow = (): void => {
		let highest = 0;
		for (const value of heights) highest = Math.max(highest, value);
		if (highest < 0.3) return;
		traceSurface((i) => height - heights[i], heights.length);
		context.lineTo(width, height);
		context.lineTo(0, height);
		context.closePath();
		const fill = context.createLinearGradient(0, height - depth, 0, height);
		fill.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
		fill.addColorStop(1, 'rgba(222, 232, 246, 0.96)');
		context.fillStyle = fill;
		// The same soft glow as the flakes.
		context.shadowColor = 'rgba(255, 255, 255, 0.6)';
		context.shadowBlur = 6 * ratio * scale;
		context.fill();
		context.shadowBlur = 0;
	};

	/** The chop's height at x, px: bigger as the puddle deepens. */
	const chop = (x: number): number => {
		const grown = scale * (0.35 + 0.65 * (level / depth));
		let sum = 0;
		for (let i = 0; i < CHOP.length; i++) {
			const wave = CHOP[i];
			sum += Math.sin((x / wave.length) * Math.PI * 2 + wave.rate * chopTime + chopPhases[i]) * wave.height;
		}
		return sum * grown;
	};

	const drawRain = (): void => {
		if (level > 0.2) {
			// A thin film doesn't ripple or chop much.
			const film = Math.min(1, level / 4);
			const spacing = width / Math.max(1, ripples.length - 1);
			for (let i = 0; i < tops.length; i++) tops[i] = height - level - (ripples[i] + chop(i * spacing)) * film;
			const top = (i: number): number => tops[i];
			traceSurface(top, ripples.length);
			context.lineTo(width, height);
			context.lineTo(0, height);
			context.closePath();
			const fill = context.createLinearGradient(0, height - level - 3, 0, height);
			fill.addColorStop(0, 'rgba(160, 186, 226, 0.42)');
			fill.addColorStop(1, 'rgba(112, 142, 192, 0.66)');
			context.fillStyle = fill;
			context.fill();
			// Light caught a little way under the surface, then the surface.
			if (level > 4 * scale) {
				traceSurface((i) => top(i) + 3 * scale, ripples.length);
				context.strokeStyle = 'rgba(225, 236, 252, 0.18)';
				context.lineWidth = 1.5 * scale;
				context.stroke();
			}
			traceSurface(top, ripples.length);
			context.strokeStyle = 'rgba(228, 238, 252, 0.9)';
			context.lineWidth = Math.max(1, 1.2 * scale);
			context.stroke();
		}
		context.fillStyle = 'rgba(174, 194, 224, 0.8)';
		const size = Math.max(1, 1.5 * scale);
		for (const splash of splashes) context.fillRect(splash.x - size / 2, splash.y - size / 2, size, size);
	};

	/** Hides the pool behind whatever stands in front of it. */
	const occlude = (): void => {
		if (!behind || weatherOccluders().size === 0) return;
		const pool = canvas.getBoundingClientRect();
		context.globalCompositeOperation = 'destination-out';
		for (const occluder of weatherOccluders()) {
			const figure = occluder();
			const rect = figure?.getBoundingClientRect();
			if (!figure || !rect || rect.height === 0 || figure.height === 0) continue;
			// Only the part of it over the pool.
			const top = Math.max(rect.top, pool.top);
			const bottom = Math.min(rect.bottom, pool.bottom);
			if (bottom <= top) continue;
			const pixels = figure.height / rect.height;
			context.drawImage(
				figure,
				0,
				(top - rect.top) * pixels,
				figure.width,
				(bottom - top) * pixels,
				rect.left - pool.left,
				top - pool.top,
				rect.width,
				bottom - top,
			);
		}
		context.globalCompositeOperation = 'source-over';
	};

	const draw = (): void => {
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		if (width === 0) return;
		if (kind === 'snow') drawSnow();
		else drawRain();
		occlude();
	};

	const resize = (): void => {
		const nextWidth = container.clientWidth;
		const nextRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
		if (nextWidth === 0 || (nextWidth === width && nextRatio === ratio)) return;
		ratio = nextRatio;
		canvas.width = Math.round(nextWidth * ratio);
		canvas.height = Math.round(height * ratio);
		width = nextWidth;
		const columns = Math.ceil(width / COLUMN) + 1;
		if (kind === 'snow') {
			heights = restored
				? resample(restored, columns).map((value) => value * depth)
				: resample(heights, columns);
			restored = undefined;
		} else if (columns !== ripples.length) {
			ripples = new Float32Array(columns);
			ripplesMoving = new Float32Array(columns);
			tops = new Float32Array(columns);
		}
	};

	/** Lets the drift slump wherever it stands steeper than snow will. */
	const slump = (): void => {
		const steepest = SNOW_SLOPE * (width / (heights.length - 1));
		for (let pass = 0; pass < 12; pass++) {
			let moved = false;
			// Alternate directions, so snow doesn't only slide one way.
			const forward = pass % 2 === 0;
			for (let step = 0; step < heights.length - 1; step++) {
				const i = forward ? step : heights.length - 2 - step;
				const difference = heights[i] - heights[i + 1];
				const excess = Math.abs(difference) - steepest;
				if (excess <= 0) continue;
				const shift = (excess / 2) * Math.sign(difference);
				heights[i] -= shift;
				heights[i + 1] += shift;
				moved = true;
			}
			if (!moved) break;
		}
	};

	const landSnow = (x: number, weight: number): void => {
		const columns = heights.length;
		const spacing = width / (columns - 1);
		const center = x * (columns - 1);
		const sigma = Math.max(1, (SNOW_SPREAD * scale) / spacing);
		// A little mound where it lands, its volume this flake's share of the
		// full drift.
		const volume = width * depth * share * weight;
		const peak = volume / (spacing * sigma * Math.sqrt(2 * Math.PI));
		const reach = Math.ceil(sigma * 3);
		for (let i = Math.max(0, Math.floor(center - reach)); i <= Math.min(columns - 1, Math.ceil(center + reach)); i++) {
			heights[i] += peak * Math.exp(-((i - center) ** 2) / (2 * sigma * sigma));
		}
		// Meanwhile the whole drift packs down under its own weight, the
		// deeper the more, until it packs down as fast as snow falls on it. So
		// it stops rising, but keeps the lumps the snow gave it.
		const packing = volume / width / depth;
		const highest = height - 2 * scale;
		for (let i = 0; i < columns; i++) heights[i] = Math.min(highest, heights[i] * (1 - packing));
		slump();
	};

	const landRain = (x: number, weight: number): void => {
		// Rises steadily, only slowing as it nears full.
		const rise = (depth * 1.25) / Math.max(1, rate * fillSeconds);
		level = Math.min(depth, level + rise * weight * (1 - (level / depth) ** 4));
		const center = Math.round(x * (ripples.length - 1));
		const impulse = RIPPLE_IMPULSE * scale * weight;
		ripplesMoving[center] -= impulse;
		if (center > 0) ripplesMoving[center - 1] -= impulse / 2;
		if (center < ripples.length - 1) ripplesMoving[center + 1] -= impulse / 2;
		// A couple of droplets thrown up where it hit.
		const surface = height - level - chop(x * width) * Math.min(1, level / 4);
		for (let i = 0; i < 2; i++) {
			splashes.push({
				x: x * width,
				y: surface,
				vx: (i === 0 ? -1 : 1) * (20 + Math.random() * 50) * scale,
				vy: -(70 + Math.random() * 90) * scale * Math.min(1.4, weight),
			});
		}
	};

	const stepRain = (): boolean => {
		const columns = ripples.length;
		chopTime += STEP;
		// Once there's water, the chop never stops.
		let moving = level > 0.2;
		for (let i = 0; i < columns; i++) {
			const left = ripples[Math.max(0, i - 1)];
			const right = ripples[Math.min(columns - 1, i + 1)];
			ripplesMoving[i] += RIPPLE_SPREAD * (left + right - 2 * ripples[i])
				- RIPPLE_TENSION * ripples[i]
				- RIPPLE_DAMPING * ripplesMoving[i];
		}
		for (let i = 0; i < columns; i++) {
			ripples[i] += ripplesMoving[i];
			if (Math.abs(ripples[i]) > 0.02 || Math.abs(ripplesMoving[i]) > 0.02) moving = true;
		}
		const surface = height - level;
		for (let i = splashes.length - 1; i >= 0; i--) {
			const splash = splashes[i];
			splash.vy += GRAVITY * scale * STEP;
			splash.x += splash.vx * STEP;
			splash.y += splash.vy * STEP;
			if (splash.vy > 0 && splash.y >= surface) splashes.splice(i, 1);
		}
		return moving || splashes.length > 0;
	};

	// It's drawn only while it can be seen. Rain runs on while there's water
	// to chop, or ripples or splashes to settle; snow is drawn again only as
	// it lands. Either is drawn again whenever what stands in front of it is.
	let seen = false;
	let frame = 0;
	let last = 0;
	let pending = 0;
	const tick = (now: number): void => {
		frame = 0;
		if (kind === 'rain') {
			pending = Math.min(pending + (last ? (now - last) / 1000 : STEP), 0.1);
			last = now;
			let moving = true;
			while (pending >= STEP) {
				moving = stepRain();
				pending -= STEP;
			}
			if (moving) frame = requestAnimationFrame(tick);
			else last = 0;
		}
		draw();
	};
	const schedule = (): void => {
		if (seen && !frame) frame = requestAnimationFrame(tick);
	};

	const update = (): void => {
		seen = inSight(canvas);
		if (!seen) {
			cancelAnimationFrame(frame);
			frame = 0;
			last = 0;
			return;
		}
		resize();
		schedule();
	};

	const save = (): void => {
		if (!persist || width === 0) return;
		const values = kind === 'rain'
			? [level / depth]
			: Array.from(resample(heights, SAVED_SAMPLES), (value) => value / depth);
		const saved: Saved = { kind, values: values.map((value) => Math.round(value * 1000) / 1000) };
		try {
			sessionStorage.setItem(persist, JSON.stringify(saved));
		} catch {
			// Storage full or blocked: the next page starts dry.
		}
	};

	const stopWatching = watchSight(canvas, update);
	const stopWatchingOccluders = behind ? watchWeatherOccluders(schedule) : undefined;
	addEventListener('pagehide', save);

	return {
		land: (x, weight = 1) => {
			if (width === 0) return;
			const at = Math.min(1, Math.max(0, x));
			if (kind === 'snow') landSnow(at, weight);
			else landRain(at, weight);
			schedule();
		},
		destroy: () => {
			stopWatching();
			stopWatchingOccluders?.();
			removeEventListener('pagehide', save);
			cancelAnimationFrame(frame);
			canvas.remove();
			// The weather's changed: what pooled goes with it.
			if (persist) {
				try {
					sessionStorage.removeItem(persist);
				} catch {
					// Nothing to clear.
				}
			}
		},
	};
}
