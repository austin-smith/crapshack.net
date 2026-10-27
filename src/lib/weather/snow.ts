/**
 * Creates a cozy snowfall effect on the page. Flakes fall and drift up along
 * the bottom (see ./pool). Where the page has surfaces (see ./surfaces), some
 * land on them too and settle: heaping up, slumping where it's too steep to
 * hold, and shaken off when what they're on moves suddenly. All of that
 * only while it's accumulating (see ./accumulation); otherwise flakes just
 * fall from view.
 */

import { createWeatherCanvas, type WeatherEffect } from './canvas';
import {
	columnAt,
	columnX,
	columnY,
	coveredAt,
	createFootings,
	hasGround,
	landingOn,
	lastPagePoint,
	pagePoint,
	type Footing,
} from './footing';
import { createPool } from './pool';

interface WeatherOptions {
	/** Particle count. Fewer for small containers such as the settings previews. */
	count?: number;
	/** Multiplies particle size, so a preview tile is not full of full-size flakes. */
	scale?: number;
	/** Multiplies fall time. A short fall needs a short time to fall it. */
	speed?: number;
	/** Lets flakes land on the page's weather surfaces. */
	settle?: boolean;
	/** About how long the drift along the bottom takes to fill, in seconds. */
	fillSeconds?: number;
	/** sessionStorage key to keep the drift along the bottom from page to page. */
	persist?: string;
	/** Lets what falls pile up: in the drift, and with `settle`, on surfaces. */
	accumulate?: boolean;
}

interface Flake {
	x: number;
	y: number;
	size: number;
	alpha: number;
	/** CSS px a second. */
	fall: number;
	/** Whether it's falling past things or onto them: some fall in front. */
	lands: boolean;
}

/** Settled snow that's come loose, tumbling as it falls. */
interface Clump {
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** CSS px². */
	area: number;
	angle: number;
	/** Radians a second. */
	spin: number;
	/** Its lumps, as offsets and radii for a clump of radius 1. */
	lumps: { x: number; y: number; radius: number }[];
}

/** What's settled on one surface. */
interface Drift {
	/** Depth at each column, in the surface's own units. */
	snow: Float32Array;
	/** Snow loosened at each column, waiting to fall as a clump: CSS px. */
	loose: Float32Array;
	/** Which way it's thrown, CSS px a second. */
	throwX: Float32Array;
	throwY: Float32Array;
	/** Whether it might stand too steep anywhere, and needs to slump. */
	settling: boolean;
}

// Of the flakes, how many are near enough to land on things.
const LANDING_SHARE = 0.65;
// How much one flake adds where it lands, as CSS px² for an average flake,
// and how widely it spreads, as a multiple of its size.
const FLAKE_AREA = 12;
const FLAKE_SPREAD = 1.6;
// The steepest settled snow stands, rise over run. Snow can't cling to
// ground steeper than this either: what slides onto it crumbles away.
const REPOSE = 0.85;
// How much hangs over an edge before it goes.
const LIP = 1.2;
// Settled snow this little steeper than it'll stand (CSS px) has settled.
const SETTLED = 0.01;
// Loose snow gathers into clumps over this many columns. Less than CLUMP_MIN
// (CSS px²) isn't enough to break away, and stays; no clump is bigger than
// CLUMP_MAX.
const CLUMP_GATHER = 10;
const CLUMP_MIN = 10;
const CLUMP_MAX = 60;
// Clumps fall through the air: a small one slows to about CLUMP_FALL (CSS px
// a second), a bigger one falls faster.
const GRAVITY = 900;
const CLUMP_FALL = 150;
const CLUMP_FALL_PER_PX = 30;
// A jolt (change in velocity between drawings, CSS px) past this starts
// shaking snow off, more the harder it is, up to SHAKE_MOST of it at once.
// He jolts about 3.5 px noticing something, and about 20 jerking awake.
const SHAKE_START = 4.5;
const SHAKE_RANGE = 20;
const SHAKE_MOST = 0.55;
// Settled snow melts this many CSS px a second once it stops snowing.
const MELT = 6;
const TAU = Math.PI * 2;

/** A glowing flake, drawn once, then scaled into place. */
function flakeSprite(): HTMLCanvasElement {
	const sprite = document.createElement('canvas');
	const radius = 16;
	const glow = 16;
	sprite.width = sprite.height = (radius + glow) * 2;
	const context = sprite.getContext('2d');
	if (!context) return sprite;
	const center = radius + glow;
	const halo = context.createRadialGradient(center, center, radius * 0.6, center, center, center);
	halo.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
	halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
	context.fillStyle = halo;
	context.fillRect(0, 0, sprite.width, sprite.height);
	context.fillStyle = '#fff';
	context.beginPath();
	context.arc(center, center, radius, 0, TAU);
	context.fill();
	return sprite;
}

export function initSnowyDay(container: HTMLElement, options: WeatherOptions = {}): WeatherEffect {
	const { count = 100, scale = 1, speed = 1, settle = false, fillSeconds, persist, accumulate = false } = options;
	const sprite = flakeSprite();
	// The sprite's flake, as a share of its width.
	const spriteCore = 16 / sprite.width;
	const average = 3.5 * scale;
	let width = 0;
	let height = 0;
	let snowing = true;
	let accumulating = accumulate;
	const flakes: Flake[] = Array.from({ length: count }, () => ({} as Flake));
	const clumps: Clump[] = [];

	const spawn = (flake: Flake, top: boolean): void => {
		flake.size = (2 + Math.random() * 3) * scale;
		flake.alpha = 0.7 + Math.random() * 0.3;
		// 6-12s to fall the height of the container, unscaled.
		const seconds = (6 + Math.random() * 6) * speed;
		flake.fall = (height + 40 * scale) / seconds;
		flake.x = Math.random() * width;
		flake.lands = Math.random() < LANDING_SHARE;
		// Staggered starts: up to 6s worth of fall above the top.
		flake.y = top ? -flake.size * 2 : -flake.size * 2 - Math.random() * 6 * speed * flake.fall;
	};

	// ---- Loose snow ----

	/**
	 * A clump of `area` CSS px² at (x, y), going (vx, vy): a lumpy piece
	 * broken off a cap of snow, wider than it's tall, rounded on top.
	 */
	const clump = (x: number, y: number, area: number, vx: number, vy: number): void => {
		const lumps = [{ x: 0, y: 0, radius: 0.62 }];
		const extra = 2 + Math.floor(Math.random() * 3);
		for (let i = 0; i < extra; i++) {
			const side = i % 2 === 0 ? -1 : 1;
			lumps.push({
				x: side * (0.35 + Math.random() * 0.4),
				y: (Math.random() - 0.6) * 0.3,
				radius: 0.38 + Math.random() * 0.22,
			});
		}
		clumps.push({
			x,
			y,
			vx,
			vy,
			area,
			// Breaking off level, then turning slowly as it falls.
			angle: (Math.random() - 0.5) * 0.5,
			spin: (Math.random() - 0.5) * 2.5,
			lumps,
		});
	};

	// ---- Settled snow ----

	/** Frees `amount` (local depth) of snow at column `i`, to fall as clumps. */
	const loosen = (footing: Footing<Drift>, i: number, amount: number, throwX: number, throwY: number): void => {
		const { data } = footing;
		const area = amount * footing.unitY * footing.surface.dx * footing.unitX;
		const total = data.loose[i] + area;
		if (total <= 0) return;
		data.throwX[i] = (data.throwX[i] * data.loose[i] + throwX * area) / total;
		data.throwY[i] = (data.throwY[i] * data.loose[i] + throwY * area) / total;
		data.loose[i] = total;
	};

	/**
	 * Lets loosened snow go: a few columns' worth at a time, breaking into a
	 * clump or two. Too little to break away settles back where it was.
	 */
	const release = (footing: Footing<Drift>): void => {
		const { loose, throwX, throwY, snow } = footing.data;
		for (let i = 0; i < loose.length; i++) {
			if (loose[i] <= 0) continue;
			let area = 0;
			let towardX = 0;
			let towardY = 0;
			const end = Math.min(loose.length, i + CLUMP_GATHER);
			for (let j = i; j < end; j++) {
				area += loose[j];
				towardX += throwX[j] * loose[j];
				towardY += throwY[j] * loose[j];
			}
			towardX /= area;
			towardY /= area;
			// Where it comes from: somewhere along those columns, in the
			// layer of snow it was; where the ground's gone from under it,
			// where that was.
			const layer = area / (footing.unitX * footing.unitY * footing.surface.dx * (end - i));
			const from = (): { x: number; y: number } | undefined => {
				const at = i + Math.floor(Math.random() * (end - i));
				const lift = snow[at] + layer * Math.random();
				if (hasGround(footing, at)) return pagePoint(footing, at, lift);
				const was = lastPagePoint(footing, at);
				return Number.isNaN(was.x) ? undefined : { x: was.x, y: was.y - lift * footing.unitY };
			};
			if (area < CLUMP_MIN) {
				// Where its ground's gone, it crumbles away.
				const depth = footing.unitX * footing.unitY * footing.surface.dx;
				for (let j = i; j < end; j++) if (hasGround(footing, j)) snow[j] += loose[j] / depth;
				footing.data.settling = true;
			}
			loose.fill(0, i, end);
			throwX.fill(0, i, end);
			throwY.fill(0, i, end);
			if (area < CLUMP_MIN) continue;
			const speed = Math.hypot(towardX, towardY);
			for (let left = area; left > 0;) {
				const piece = left < CLUMP_MAX * 1.5 ? left : CLUMP_MAX * (0.6 + Math.random() * 0.4);
				left -= piece;
				const point = from();
				// Where something's in front of it, it goes unseen.
				if (!point || coveredAt(footing, point.x, point.y)) continue;
				// Each piece goes a little its own way, more so the harder it's thrown.
				const scatter = 10 + speed * 0.15;
				clump(point.x, point.y, piece, towardX + (Math.random() - 0.5) * 2 * scatter, towardY - Math.random() * scatter);
			}
		}
	};

	const footings = createFootings<Drift>({
		create: (surface) => {
			const columns = surface.ground.length;
			return {
				snow: new Float32Array(columns),
				loose: new Float32Array(columns),
				throwX: new Float32Array(columns),
				throwY: new Float32Array(columns),
				settling: false,
			};
		},
		changed: (footing, before) => {
			const { data, surface, jolt, motion } = footing;
			const columns = surface.ground.length;
			data.settling = true;
			if (before !== undefined && data.snow.length !== columns) {
				// Laid out afresh: keep what's settled, stretched to fit.
				const previous = data.snow;
				data.snow = new Float32Array(columns);
				for (let i = 0; i < columns; i++) {
					data.snow[i] = previous[Math.floor((i / Math.max(1, columns - 1)) * (previous.length - 1))] ?? 0;
				}
				data.loose = new Float32Array(columns);
				data.throwX = new Float32Array(columns);
				data.throwY = new Float32Array(columns);
			}
			for (let i = 0; i < columns; i++) {
				if (!(data.snow[i] > 0)) continue;
				if (Number.isNaN(surface.ground[i])) {
					// The ground's gone from under it: it falls.
					loosen(footing, i, data.snow[i], 0, 0);
					data.snow[i] = 0;
					continue;
				}
				// A jolt: how suddenly it changed course. Pushing up into the
				// snow only packs it down; stopping short on the way up,
				// dropping away, or swinging back the other way throws it.
				const joltX = jolt[i * 2];
				const joltY = jolt[i * 2 + 1];
				const strength = Math.hypot(joltX, Math.max(joltY, -joltY * 0.25));
				const share = Math.min(SHAKE_MOST, Math.max(0, (strength - SHAKE_START) / SHAKE_RANGE));
				if (share <= 0) continue;
				const amount = data.snow[i] * share;
				data.snow[i] -= amount;
				// It carries on the way it was going.
				const wasX = (motion[i * 2] - joltX) * surface.pace;
				const wasY = (motion[i * 2 + 1] - joltY) * surface.pace;
				loosen(footing, i, amount, wasX, Math.min(0, wasY) - 30 * Math.random());
			}
		},
		removed: (footing) => {
			// Gone from the page: whatever was on it falls.
			const { snow } = footing.data;
			for (let i = 0; i < snow.length; i++) {
				if (snow[i] > 0) loosen(footing, i, snow[i], 0, 0);
				snow[i] = 0;
			}
			release(footing);
		},
	});

	/** Settled snow's top at a column, on the page. */
	const snowTop = (footing: Footing<Drift>, column: number): number => pagePoint(footing, column, footing.data.snow[column]).y;

	/** Lands `area` CSS px² at page point (x, y), spread about `spread` CSS px either side. */
	const land = (footing: Footing<Drift>, x: number, y: number, area: number, spread: number): void => {
		const { surface, data } = footing;
		const center = columnAt(footing, x, y);
		const column = Math.round(center);
		const local = area / (footing.unitX * footing.unitY);
		const sigma = Math.max(1, spread / (footing.unitX * surface.dx));
		const peak = local / (surface.dx * sigma * Math.sqrt(TAU));
		const most = surface.depth / footing.unitY;
		const reach = Math.ceil(sigma * 2.5);
		data.settling = true;
		for (let i = Math.max(0, column - reach); i <= Math.min(surface.ground.length - 1, column + reach); i++) {
			if (Number.isNaN(surface.ground[i])) continue;
			const room = Math.max(0, 1 - data.snow[i] / most);
			data.snow[i] += peak * Math.exp(-((i - center) ** 2) / (2 * sigma * sigma)) * room;
		}
	};

	/**
	 * Lets settled snow find its slope: too steep and it slides, or crumbles
	 * away. Returns whether it's still settling.
	 */
	const slump = (footing: Footing<Drift>): boolean => {
		const { ground } = footing.surface;
		const { snow } = footing.data;
		const columns = ground.length;
		const lip = LIP / footing.unitY;
		const least = SETTLED / footing.unitY;
		for (let pass = 0; pass < 6; pass++) {
			let moved = false;
			const forward = pass % 2 === 0;
			for (let step = 0; step < columns; step++) {
				const i = forward ? step : columns - 1 - step;
				if (!(snow[i] > 0) || Number.isNaN(ground[i])) continue;
				for (let side = -1; side <= 1; side += 2) {
					const j = i + side;
					if (j < 0 || j >= columns || Number.isNaN(ground[j])) {
						// An edge: what hangs over it crumbles away.
						if (snow[i] - lip > least) {
							snow[i] -= (snow[i] - lip) * 0.5;
							moved = true;
						}
						continue;
					}
					const run = Math.abs(columnX(footing, j, snow[j]) - columnX(footing, i, snow[i])) || 0.01;
					const excess = columnY(footing, j, snow[j]) - columnY(footing, i, snow[i]) - REPOSE * run;
					if (excess <= SETTLED) continue;
					const amount = Math.min(snow[i], excess / (2 * footing.unitY));
					snow[i] -= amount;
					moved = true;
					// Down a slope too steep to hold it, it crumbles away;
					// otherwise it slides down.
					const groundRun = Math.abs(columnX(footing, j) - columnX(footing, i)) || 0.01;
					if ((columnY(footing, j) - columnY(footing, i)) / groundRun <= REPOSE) snow[j] += amount;
				}
			}
			if (!moved) return false;
		}
		return true;
	};

	// ---- Drawing ----

	const drawFlakes = (context: CanvasRenderingContext2D): void => {
		for (const flake of flakes) {
			const drawn = flake.size / (spriteCore * 2);
			context.globalAlpha = flake.alpha;
			context.drawImage(sprite, flake.x - drawn / 2, flake.y - drawn / 2, drawn, drawn);
		}
		context.globalAlpha = 1;
	};

	const drawClumps = (context: CanvasRenderingContext2D): void => {
		for (const piece of clumps) {
			const radius = Math.max(0.8, Math.sqrt(piece.area / Math.PI)) * 0.95;
			const cos = Math.cos(piece.angle);
			const sin = Math.sin(piece.angle);
			// Lit from above: white on top, cooler underneath.
			const shade = context.createLinearGradient(0, piece.y - radius, 0, piece.y + radius);
			shade.addColorStop(0, '#fff');
			shade.addColorStop(1, 'rgb(214, 226, 243)');
			context.fillStyle = shade;
			context.beginPath();
			for (const lump of piece.lumps) {
				const x = piece.x + (lump.x * cos - lump.y * sin) * radius;
				const y = piece.y + (lump.x * sin + lump.y * cos) * radius;
				context.moveTo(x + lump.radius * radius, y);
				context.arc(x, y, lump.radius * radius, 0, TAU);
			}
			context.fill();
		}
	};

	/** Each run of settled snow on a surface, as one soft-topped shape. */
	const drawDrift = (context: CanvasRenderingContext2D, footing: Footing<Drift>): void => {
		const { ground } = footing.surface;
		const { snow } = footing.data;
		const columns = ground.length;
		const visible = 0.6 / footing.unitY;
		let i = 0;
		while (i < columns) {
			if (!(snow[i] > visible) || Number.isNaN(ground[i])) {
				i++;
				continue;
			}
			// Take in a column either side where there's ground, to taper.
			let start = i;
			if (start > 0 && !Number.isNaN(ground[start - 1])) start--;
			let end = i;
			while (end + 1 < columns && !Number.isNaN(ground[end + 1]) && (snow[end + 1] > visible || snow[end] > visible)) end++;
			i = end + 1;
			if (end === start) continue;
			const topX = (j: number): number => columnX(footing, j, snow[j]);
			const topY = (j: number): number => columnY(footing, j, snow[j]);
			context.beginPath();
			context.moveTo(columnX(footing, start), columnY(footing, start));
			context.lineTo(topX(start), topY(start));
			for (let j = start + 1; j < end; j++) {
				context.quadraticCurveTo(topX(j), topY(j), (topX(j) + topX(j + 1)) / 2, (topY(j) + topY(j + 1)) / 2);
			}
			context.lineTo(topX(end), topY(end));
			for (let j = end; j >= start; j--) context.lineTo(columnX(footing, j), columnY(footing, j));
			context.closePath();
			context.fillStyle = 'rgba(255, 255, 255, 0.95)';
			context.fill();
		}
	};

	// ---- The loop ----

	const weather = createWeatherCanvas(container, {
		resize: (nextWidth, nextHeight) => {
			const first = width === 0;
			// Each flake keeps its time to fall, whatever the height.
			const stretch = (nextHeight + 40 * scale) / (height + 40 * scale);
			width = nextWidth;
			height = nextHeight;
			for (const flake of flakes) {
				if (first) spawn(flake, false);
				else flake.fall *= stretch;
			}
		},
		frame: ({ context, seconds, layer }) => {
			if (settle && accumulating) footings.sync();

			if (snowing) {
				for (const flake of flakes) {
					const lastY = flake.y;
					flake.y += flake.fall * seconds;
					if (flake.lands && footings.size) {
						const footing = landingOn(footings.values(), flake.x, flake.y, lastY, snowTop);
						if (footing) {
							land(footing, flake.x, flake.y, FLAKE_AREA * (flake.size / average) ** 2, flake.size * FLAKE_SPREAD);
							spawn(flake, true);
							continue;
						}
					}
					if (flake.y > height) {
						pool?.land(flake.x / width, flake.size / average);
						spawn(flake, true);
					}
				}
			}

			for (let index = clumps.length - 1; index >= 0; index--) {
				const piece = clumps[index];
				const lastY = piece.y;
				// Falling through air: it slows toward the speed its size falls at.
				const radius = Math.sqrt(piece.area / Math.PI);
				const fastest = (CLUMP_FALL + CLUMP_FALL_PER_PX * radius) * Math.sqrt(scale);
				const speed = Math.hypot(piece.vx, piece.vy);
				const drag = (GRAVITY / (fastest * fastest)) * speed * seconds;
				piece.vx -= piece.vx * Math.min(1, drag);
				piece.vy += GRAVITY * seconds - piece.vy * Math.min(1, drag);
				piece.x += piece.vx * seconds;
				piece.y += piece.vy * seconds;
				piece.angle += piece.spin * seconds;
				piece.spin *= 1 - Math.min(1, 0.8 * seconds);
				if (piece.vy > 0) {
					const footing = landingOn(footings.values(), piece.x, piece.y, lastY, snowTop);
					if (footing) {
						land(footing, piece.x, piece.y, piece.area, Math.sqrt(piece.area) * 1.2);
						clumps.splice(index, 1);
						continue;
					}
				}
				if (piece.y > height) {
					pool?.land(piece.x / width, piece.area / FLAKE_AREA);
					clumps.splice(index, 1);
				}
			}

			let settled = false;
			for (const footing of footings.values()) {
				const { data } = footing;
				if (data.settling) data.settling = slump(footing);
				if (!snowing) {
					const melt = (MELT * seconds) / footing.unitY;
					for (let i = 0; i < data.snow.length; i++) {
						if (!(data.snow[i] > 0)) continue;
						data.snow[i] = Math.max(0, data.snow[i] - melt);
						data.settling = true;
					}
				}
				release(footing);
				if (!settled) settled = data.snow.some((depth) => depth > 0);
				drawDrift(footing.surface.layer ? layer(footing.surface.layer) : context, footing);
			}
			drawClumps(context);
			if (snowing) drawFlakes(context);
			// Once it's stopped and everything's melted or fallen, it's done.
			return snowing || settled || clumps.length > 0;
		},
	});
	// Each flake lands in the drift as its fall ends: 9s, on average.
	const startPool = () => (weather ? createPool(container, { kind: 'snow', scale, rate: count / (9 * speed), fillSeconds, persist, behind: settle }) : undefined);
	let pool = accumulating ? startPool() : undefined;

	return {
		accumulate: (on) => {
			if (on === accumulating || !snowing) return;
			accumulating = on;
			if (on) {
				pool = startPool();
				return;
			}
			pool?.destroy();
			pool = undefined;
			// What's settled on him falls off, past where the drift was.
			footings.clear();
		},
		stop: () => {
			pool?.destroy();
			pool = undefined;
			// What's settled on things melts away rather than vanishing.
			snowing = false;
			if (!weather?.running()) weather?.finish();
		},
	};
}
