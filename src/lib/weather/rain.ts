/**
 * Creates a cozy rain effect on the page. Drops fall into a puddle along the
 * bottom (see ./pool). Where the page has surfaces (see ./surfaces), some hit
 * them instead: they splash, and what of the water's left gathers into
 * beads that grow as more drops hit, run downhill once they're heavy enough,
 * and drip off the edge, onto whatever's below. The beads aren't drawn;
 * what shows is what they soak (a surface's `soaks`), and what runs or is
 * shaken off them, falling as rain. All of that only while it's accumulating
 * (see ./accumulation); otherwise drops just fall from view.
 */

import { createWeatherCanvas, type WeatherEffect, type WeatherOptions } from './canvas';
import {
	columnAt,
	coveredAt,
	createFootings,
	hasGround,
	joltAt,
	landingOn,
	lastPagePoint,
	pagePoint,
	SHAKES_OFF,
	wasMoving,
	type Footing,
} from './footing';
import { createPool } from './pool';
import { drawSoaked, drying, dry, soak } from './soak';

interface Raindrop {
	x: number;
	/** Its top, CSS px. */
	y: number;
	length: number;
	alpha: number;
	/** CSS px a second. */
	fall: number;
	/** Whether it's falling past things or onto them: some fall in front. */
	lands: boolean;
	/** Whether it's reached the puddle, and is only finishing its fall from view. */
	pooled: boolean;
}

/** Water on its way down: dripped, thrown, or splashed. */
interface Falling {
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** CSS px², as a bead's. */
	volume: number;
}

interface Spray {
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Where it came from: it's gone once it falls back past here. */
	floor: number;
}

/** A bead of water sitting on a surface. */
interface Bead {
	/** Where along the surface, in columns. */
	at: number;
	/** CSS px²: about its area, seen from the front. */
	volume: number;
	/** How fast it's running downhill, CSS px a second. */
	speed: number;
	/** Which way it runs where the surface is flat: -1 or 1. */
	lean: number;
	/** Where it is, as of this frame. */
	shape?: BeadShape;
}

/** Where a bead is: its middle, its size, and the surface's angle under it. */
interface BeadShape {
	x: number;
	y: number;
	rx: number;
	ry: number;
	angle: number;
	/** Page px per column, along the surface. */
	stride: number;
	/** How steep it is there, 0 to 1, and which way along it is down. */
	slope: number;
	downhill: number;
}

interface Wet {
	beads: Bead[];
}

// Of the drops, how many are near enough to land on things, and of those,
// how many leave a bead.
const LANDING_SHARE = 0.6;
const BEADING_SHARE = 0.55;
// How much water a drop leaves, CSS px², for an average drop.
const DROP_WATER = 9;
// A bead holds on until it's this heavy for the slope it's on (volume times
// the slope's sine), or this heavy at all.
const PIN = 12;
const MOST_STILL = 60;
// How fast a running bead goes, for its slope and size; and how fast it
// gets there.
const RUN = 16;
const RUN_EASE = 6;
// How much a running bead leaves behind, a second, as a share of itself.
const SMEAR = 0.04;
// Beads dry this much a second, CSS px²; far quicker once it's stopped
// raining.
const EVAPORATE = 0.12;
const DRY = 5;
const SMALLEST = 0.5;
const MOST_BEADS = 40;
// A drop landing this near a bead, CSS px, runs into it.
const GATHER = 7;
// How far either side of where it lands, CSS px, an average drop soaks
// what it's on (see ./soak), and how much.
const SOAK_REACH = 10;
const SOAK = 0.12;
// A jolt this much harder, CSS px, than one that shakes things off (see
// ./footing) flings every bead off; less, fewer of them.
const SHAKE_RANGE = 8;
const GRAVITY = 1400;
const FASTEST = 900;
const AVERAGE_LENGTH = 27.5;
const COLOR = '174, 194, 224';

/** A streak of rain, drawn once, then stretched into place. */
function dropSprite(): HTMLCanvasElement {
	const sprite = document.createElement('canvas');
	sprite.width = 4;
	sprite.height = 64;
	const context = sprite.getContext('2d');
	if (!context) return sprite;
	const fade = context.createLinearGradient(0, 0, 0, sprite.height);
	fade.addColorStop(0, `rgba(${COLOR}, 0)`);
	fade.addColorStop(0.5, `rgba(${COLOR}, 0.8)`);
	fade.addColorStop(1, `rgba(${COLOR}, 0)`);
	context.fillStyle = fade;
	context.fillRect(0, 0, sprite.width, sprite.height);
	return sprite;
}

const radiusOf = (volume: number): number => Math.max(0.7, Math.sqrt(volume / Math.PI));

export function initRainyDay(container: HTMLElement, options: WeatherOptions = {}): WeatherEffect {
	const { count = 100, scale = 1, speed = 1, settle = false, fillSeconds, persist, accumulate = false, ground = container } = options;
	const sprite = dropSprite();
	const streak = Math.max(1.5, 2 * scale);
	const average = AVERAGE_LENGTH * scale;
	let width = 0;
	let height = 0;
	let raining = true;
	let accumulating = accumulate;
	const drops: Raindrop[] = Array.from({ length: count }, () => ({} as Raindrop));
	const falling: Falling[] = [];
	const sprays: Spray[] = [];

	const spawn = (drop: Raindrop, top: boolean): void => {
		drop.length = (15 + Math.random() * 25) * scale;
		drop.alpha = 0.3 + Math.random() * 0.5;
		// 1.5-4s to fall from just above the top to just below the bottom.
		const seconds = (1.5 + Math.random() * 2.5) * speed;
		drop.fall = (height + 50 * scale) / seconds;
		drop.x = Math.random() * width;
		drop.lands = Math.random() < LANDING_SHARE;
		drop.pooled = false;
		// Staggered starts: up to 5s worth of fall above the top.
		drop.y = -50 * scale - (top ? 0 : Math.random() * 5 * speed * drop.fall);
	};

	const splash = (x: number, y: number, strength: number): void => {
		const pieces = 2 + Math.floor(Math.random() * 2 * strength);
		for (let i = 0; i < pieces; i++) {
			const side = Math.random() < 0.5 ? -1 : 1;
			sprays.push({
				x,
				y: y - 0.5,
				vx: side * (25 + Math.random() * 70) * scale,
				vy: -(50 + Math.random() * 110) * scale * Math.min(1.5, strength),
				floor: y + 4 * scale,
			});
		}
	};

	// ---- Beads ----

	const beadShape = (footing: Footing<Wet>, bead: Bead): BeadShape => {
		const ground = pagePoint(footing, bead.at);
		const before = pagePoint(footing, bead.at - 0.5);
		const after = pagePoint(footing, bead.at + 0.5);
		const tangentX = after.x - before.x;
		const tangentY = after.y - before.y;
		const length = Math.hypot(tangentX, tangentY) || 1;
		// Up and away from the surface.
		let normalX = tangentY / length;
		let normalY = -tangentX / length;
		if (normalY > 0) {
			normalX = -normalX;
			normalY = -normalY;
		}
		const radius = radiusOf(bead.volume);
		// Sitting on something, a bead spreads a little and flattens.
		const rx = radius * 1.12;
		const ry = radius * 0.86;
		return {
			x: ground.x + normalX * ry * 0.9,
			y: ground.y + normalY * ry * 0.9,
			rx,
			ry,
			angle: Math.atan2(tangentY, tangentX),
			stride: length,
			slope: Math.abs(tangentY) / length,
			downhill: Math.sign(tangentY),
		};
	};

	/**
	 * Lets a bead go from its surface, at its place, going its way; where
	 * the surface has gone from under it, from where that was. Where
	 * something's in front of it there, it goes unseen.
	 */
	const detach = (footing: Footing<Wet>, bead: Bead, vx: number, vy: number): void => {
		let from: { x: number; y: number } | undefined;
		if (hasGround(footing, bead.at)) from = beadShape(footing, bead);
		else {
			const was = lastPagePoint(footing, bead.at);
			if (!Number.isNaN(was.x)) from = { x: was.x, y: was.y - radiusOf(bead.volume) };
		}
		if (from && !coveredAt(footing, from.x, from.y)) falling.push({ x: from.x, y: from.y, vx, vy, volume: bead.volume });
		bead.volume = 0;
	};

	/** Soaks the surface around column `at` with `volume` of water, where it soaks. */
	const soakAround = (footing: Footing<Wet>, at: number, volume: number): void => {
		if (!footing.surface.soaks) return;
		const stride = Math.max(0.1, footing.unitX * footing.surface.dx);
		const reach = Math.max(1, Math.round(SOAK_REACH / stride));
		const center = Math.round(at);
		for (let column = center - reach; column <= center + reach; column++) {
			const near = 1 - Math.abs(column - center) / (reach + 1);
			soak(footing, column, SOAK * (volume / DROP_WATER) * near);
		}
	};

	/** Puts `volume` of water on a surface at page point (x, y): into a bead there, or a new one. */
	const wet = (footing: Footing<Wet>, x: number, y: number, volume: number): void => {
		const at = columnAt(footing, x, y);
		if (!hasGround(footing, at)) return;
		soakAround(footing, at, volume);
		const { beads } = footing.data;
		let nearest: Bead | undefined;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const bead of beads) {
			const shape = beadShape(footing, bead);
			const distance = Math.hypot(shape.x - x, shape.y - y) - shape.rx;
			if (distance < nearestDistance) {
				nearest = bead;
				nearestDistance = distance;
			}
		}
		if (nearest && (nearestDistance < GATHER * scale || beads.length >= MOST_BEADS)) {
			nearest.volume += volume;
			return;
		}
		beads.push({ at, volume, speed: 0, lean: Math.random() < 0.5 ? -1 : 1 });
	};

	const footings = createFootings<Wet>({
		create: () => ({ beads: [] }),
		changed: (footing) => {
			for (const bead of footing.data.beads) {
				const column = Math.round(bead.at);
				if (!hasGround(footing, column)) {
					// The surface has gone from under it: it drops.
					detach(footing, bead, 0, 0);
					continue;
				}
				if (Math.random() >= (joltAt(footing, column) - SHAKES_OFF) / SHAKE_RANGE) continue;
				// Flung on the way it was going.
				const was = wasMoving(footing, column);
				detach(footing, bead, was.x + (Math.random() - 0.5) * 40, Math.min(0, was.y) - Math.random() * 60);
			}
			footing.data.beads = footing.data.beads.filter((bead) => bead.volume > 0);
		},
		removed: (footing) => {
			for (const bead of footing.data.beads) detach(footing, bead, 0, 0);
			footing.data.beads = [];
			dry(footing.surface);
		},
	});

	/** Lets each bead dry, hold, or run, and drip where its surface ends. */
	const flow = (footing: Footing<Wet>, seconds: number): void => {
		const { beads } = footing.data;
		for (const bead of beads) bead.shape = bead.volume > 0 ? beadShape(footing, bead) : undefined;
		for (const bead of beads) {
			if (bead.volume <= 0 || !bead.shape) continue;
			bead.volume -= (raining ? EVAPORATE : DRY) * seconds;
			if (bead.volume < SMALLEST) {
				bead.volume = 0;
				continue;
			}
			const { shape } = bead;
			const pull = bead.volume * shape.slope;
			const heavy = bead.volume > MOST_STILL;
			if (pull < PIN && !heavy) {
				bead.speed = 0;
				continue;
			}
			const target = RUN * Math.max(shape.slope, heavy ? 0.25 : 0) * Math.sqrt(bead.volume);
			bead.speed += (target - bead.speed) * Math.min(1, RUN_EASE * seconds);
			const way = shape.downhill || bead.lean;
			const before = bead.at;
			bead.at += (way * bead.speed * seconds) / shape.stride;
			bead.volume *= 1 - SMEAR * seconds;
			if (!hasGround(footing, bead.at)) {
				// Off the edge: it drips.
				bead.at = before;
				const along = shape.angle;
				detach(footing, bead, Math.cos(along) * way * bead.speed, Math.max(0, Math.sin(along) * way * bead.speed));
				continue;
			}
			// Running into another bead, it takes it in.
			const moved = beadShape(footing, bead);
			bead.shape = moved;
			for (const other of beads) {
				if (other === bead || other.volume <= 0 || !other.shape) continue;
				const there = other.shape;
				if (Math.hypot(there.x - moved.x, there.y - moved.y) < (there.rx + moved.rx) * 0.85) {
					bead.volume += other.volume;
					other.volume = 0;
				}
			}
		}
		footing.data.beads = beads.filter((bead) => bead.volume > 0);
	};

	// ---- Drawing ----

	/** What runs or is shaken off a surface, falling: as rain again. */
	const drawFalling = (context: CanvasRenderingContext2D): void => {
		context.globalAlpha = 0.75;
		for (const drop of falling) {
			const radius = radiusOf(drop.volume);
			// Drawn out as it gathers speed.
			const stretch = 1 + Math.min(1.6, Math.hypot(drop.vx, drop.vy) / 500);
			context.drawImage(sprite, drop.x - streak / 2, drop.y - radius * stretch * 3, streak, radius * stretch * 6);
		}
		context.globalAlpha = 1;
	};

	const drawSprays = (context: CanvasRenderingContext2D): void => {
		context.fillStyle = 'rgba(205, 220, 244, 0.85)';
		const size = Math.max(1, 1.3 * scale);
		for (const spray of sprays) context.fillRect(spray.x - size / 2, spray.y - size / 2, size, size);
	};

	const drawDrops = (context: CanvasRenderingContext2D): void => {
		for (const drop of drops) {
			context.globalAlpha = drop.alpha;
			context.drawImage(sprite, drop.x - streak / 2, drop.y, streak, drop.length);
		}
		context.globalAlpha = 1;
	};

	// ---- The loop ----

	const weather = createWeatherCanvas(container, {
		resize: (nextWidth, nextHeight) => {
			const first = width === 0;
			// Each drop keeps its time to fall, whatever the height.
			const stretch = (nextHeight + 50 * scale) / (height + 50 * scale);
			width = nextWidth;
			height = nextHeight;
			for (const drop of drops) {
				if (first) spawn(drop, false);
				else drop.fall *= stretch;
			}
		},
		frame: ({ context, seconds, time, layer }) => {
			if (settle && accumulating) footings.sync();

			if (raining) {
				for (const drop of drops) {
					const lastTip = drop.y + drop.length;
					drop.y += drop.fall * seconds;
					const tip = drop.y + drop.length;
					const weight = drop.length / average;
					if (drop.lands && !drop.pooled && footings.size) {
						const footing = landingOn(footings.values(), drop.x, tip, lastTip);
						if (footing) {
							const ground = pagePoint(footing, Math.round(columnAt(footing, drop.x, tip)));
							splash(drop.x, ground.y, weight);
							if (Math.random() < BEADING_SHARE) wet(footing, drop.x, ground.y, DROP_WATER * weight);
							spawn(drop, true);
							continue;
						}
					}
					if (!drop.pooled && tip > height) {
						pool?.land(drop.x / width, weight);
						drop.pooled = true;
					}
					if (drop.y > height) spawn(drop, true);
				}
			}

			for (let index = falling.length - 1; index >= 0; index--) {
				const drop = falling[index];
				const lastY = drop.y;
				drop.vy = Math.min(FASTEST, drop.vy + GRAVITY * seconds);
				drop.x += drop.vx * seconds;
				drop.y += drop.vy * seconds;
				if (drop.vy > 0) {
					const footing = landingOn(footings.values(), drop.x, drop.y, lastY);
					if (footing) {
						const ground = pagePoint(footing, Math.round(columnAt(footing, drop.x, drop.y)));
						splash(drop.x, ground.y, Math.min(1.5, drop.volume / 10));
						wet(footing, drop.x, ground.y, drop.volume * 0.8);
						falling.splice(index, 1);
						continue;
					}
				}
				if (drop.y > height) {
					pool?.land(drop.x / width, Math.min(2, drop.volume / 10));
					falling.splice(index, 1);
				}
			}

			for (let index = sprays.length - 1; index >= 0; index--) {
				const spray = sprays[index];
				spray.vy += GRAVITY * scale * seconds;
				spray.x += spray.vx * seconds;
				spray.y += spray.vy * seconds;
				if (spray.vy > 0 && spray.y > spray.floor) sprays.splice(index, 1);
			}

			let lingering = false;
			for (const footing of footings.values()) {
				flow(footing, seconds);
				const soaked = drying(footing, time, seconds);
				if (!lingering) lingering = soaked || footing.data.beads.length > 0;
				// In its place on the page, if it has one, behind what's in front of it.
				if (soaked) drawSoaked(() => layer(footing.surface.layer), footing, time);
			}
			// What's falling goes into the puddle, wherever that's drawn.
			context.save();
			pool?.clipAbove(context, container.getBoundingClientRect());
			drawFalling(context);
			drawSprays(context);
			if (raining) drawDrops(context);
			context.restore();
			// Once it's stopped and everything's dried or fallen, it's done.
			return raining || lingering || falling.length > 0 || sprays.length > 0;
		},
	});
	// Each drop lands in the puddle as its fall ends: 2.75s, on average.
	const startPool = () => (weather ? createPool(ground, { kind: 'rain', scale, rate: count / (2.75 * speed), fillSeconds, persist }) : undefined);
	let pool = accumulating ? startPool() : undefined;

	return {
		accumulate: (on) => {
			if (on === accumulating || !raining) return;
			accumulating = on;
			if (on) {
				pool = startPool();
				return;
			}
			pool?.destroy();
			pool = undefined;
			// What's beaded on him drips off, past where the puddle was.
			footings.clear();
		},
		stop: () => {
			pool?.destroy();
			pool = undefined;
			// What's beaded on things dries off rather than vanishing.
			raining = false;
			if (!weather?.running()) weather?.finish();
		},
	};
}
