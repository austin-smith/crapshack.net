/**
 * Creates a cozy rain effect on the page. Drops fall into a puddle along the
 * bottom (see ./pool). Where the page has surfaces (see ./surfaces), some hit
 * them instead: they splash, and leave beads of water that grow as more
 * drops hit, run downhill once they're heavy enough, leaving a wet trail,
 * and drip off the edge, onto whatever's below. All of that only while it's
 * accumulating (see ./accumulation); otherwise drops just fall from view.
 */

import { createWeatherCanvas, type WeatherEffect } from './canvas';
import { columnAt, createFootings, hasGround, landingOn, lastPagePoint, pagePoint, type Footing } from './footing';
import { createPool } from './pool';

interface WeatherOptions {
	/** Particle count. Fewer for small containers such as the settings previews. */
	count?: number;
	/** Multiplies particle length, so a preview tile is not full of full-size drops. */
	scale?: number;
	/** Multiplies fall time. A short fall needs a short time to fall it. */
	speed?: number;
	/** Lets drops land on the page's weather surfaces. */
	settle?: boolean;
	/** About how long the puddle takes to fill, in seconds. */
	fillSeconds?: number;
	/** sessionStorage key to keep the puddle from page to page. */
	persist?: string;
	/** Lets what falls pile up: in the puddle, and with `settle`, on surfaces. */
	accumulate?: boolean;
}

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
	/** Where it's been lately, wetting the surface: columns, and seconds ago. */
	trail: { at: number; age: number }[];
	/** How it's drawn, as of this frame. */
	shape?: BeadShape;
}

/** Where a bead is drawn: its middle, its size, and the surface's angle under it. */
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
// How far a wet trail lasts.
const TRAIL_SECONDS = 1.4;
// A jolt (change in velocity between drawings, CSS px) past this starts
// flinging beads off; by START + RANGE, all of them go. He jolts about 3.5 px
// noticing something, and about 20 jerking awake.
const SHAKE_START = 4.5;
const SHAKE_RANGE = 8;
const GRAVITY = 1400;
const FASTEST = 900;
const AVERAGE_LENGTH = 27.5;
const TAU = Math.PI * 2;
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

/**
 * A bead of water as drawn: clear, so what's under it shows through, with
 * a darker rim where it bends the light, and a glint.
 */
function drawWater(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, angle: number): void {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	const body = context.createRadialGradient(-rx * 0.3, -ry * 0.35, 0, 0, 0, Math.max(rx, ry));
	body.addColorStop(0, 'rgba(236, 244, 255, 0.45)');
	body.addColorStop(0.65, 'rgba(176, 198, 230, 0.45)');
	body.addColorStop(1, 'rgba(100, 128, 172, 0.7)');
	context.fillStyle = body;
	context.beginPath();
	context.ellipse(0, 0, rx, ry, 0, 0, TAU);
	context.fill();
	context.strokeStyle = 'rgba(52, 76, 116, 0.6)';
	context.lineWidth = Math.max(0.6, Math.min(rx, ry) * 0.2);
	context.stroke();
	context.fillStyle = 'rgba(255, 255, 255, 0.92)';
	context.beginPath();
	context.ellipse(-rx * 0.34, -ry * 0.38, rx * 0.3, ry * 0.22, -0.4, 0, TAU);
	context.fill();
	if (Math.min(rx, ry) > 1.6) {
		// Light gathered through it, at the bottom.
		context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
		context.lineWidth = Math.min(rx, ry) * 0.18;
		context.beginPath();
		context.ellipse(0, 0, rx * 0.66, ry * 0.62, 0, Math.PI * 0.2, Math.PI * 0.75);
		context.stroke();
	}
	context.restore();
}

export function initRainyDay(container: HTMLElement, options: WeatherOptions = {}): WeatherEffect {
	const { count = 100, scale = 1, speed = 1, settle = false, fillSeconds, persist, accumulate = false } = options;
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
	 * the surface has gone from under it, from where that was.
	 */
	const detach = (footing: Footing<Wet>, bead: Bead, vx: number, vy: number): void => {
		if (hasGround(footing, bead.at)) {
			const shape = beadShape(footing, bead);
			falling.push({ x: shape.x, y: shape.y, vx, vy, volume: bead.volume });
		} else {
			const was = lastPagePoint(footing, bead.at);
			if (!Number.isNaN(was.x)) falling.push({ x: was.x, y: was.y - radiusOf(bead.volume), vx, vy, volume: bead.volume });
		}
		bead.volume = 0;
	};

	/** Puts `volume` of water on a surface at page point (x, y): into a bead there, or a new one. */
	const wet = (footing: Footing<Wet>, x: number, y: number, volume: number): void => {
		const at = columnAt(footing, x, y);
		if (!hasGround(footing, at)) return;
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
		beads.push({ at, volume, speed: 0, lean: Math.random() < 0.5 ? -1 : 1, trail: [] });
	};

	const footings = createFootings<Wet>({
		create: () => ({ beads: [] }),
		changed: (footing) => {
			const { jolt, motion, surface } = footing;
			for (const bead of footing.data.beads) {
				const column = Math.round(bead.at);
				if (!hasGround(footing, column)) {
					// The surface has gone from under it: it drops.
					detach(footing, bead, 0, 0);
					continue;
				}
				const joltX = jolt[column * 2];
				const joltY = jolt[column * 2 + 1];
				const strength = Math.hypot(joltX, Math.max(joltY, -joltY * 0.25));
				if (Math.random() >= (strength - SHAKE_START) / SHAKE_RANGE) continue;
				// Flung on the way it was going.
				const wasX = (motion[column * 2] - joltX) * surface.pace;
				const wasY = (motion[column * 2 + 1] - joltY) * surface.pace;
				detach(footing, bead, wasX + (Math.random() - 0.5) * 40, Math.min(0, wasY) - Math.random() * 60);
			}
			footing.data.beads = footing.data.beads.filter((bead) => bead.volume > 0);
		},
		removed: (footing) => {
			for (const bead of footing.data.beads) detach(footing, bead, 0, 0);
			footing.data.beads = [];
		},
	});

	/** Lets each bead dry, hold, or run, and drip where its surface ends. */
	const flow = (footing: Footing<Wet>, seconds: number): void => {
		const { beads } = footing.data;
		for (const bead of beads) bead.shape = bead.volume > 0 ? beadShape(footing, bead) : undefined;
		for (const bead of beads) {
			if (bead.volume <= 0 || !bead.shape) continue;
			bead.volume -= (raining ? EVAPORATE : DRY) * seconds;
			for (const mark of bead.trail) mark.age += seconds;
			while (bead.trail.length && bead.trail[0].age > TRAIL_SECONDS) bead.trail.shift();
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
			const last = bead.trail[bead.trail.length - 1];
			if (!last || Math.abs(last.at - before) * shape.stride > 1.5) bead.trail.push({ at: before, age: 0 });
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
		footing.data.beads = beads.filter((bead) => bead.volume > 0 || bead.trail.length > 0);
	};

	// ---- Drawing ----

	const drawWet = (context: CanvasRenderingContext2D, footing: Footing<Wet>): void => {
		// Trails first, under the beads that left them.
		context.lineCap = 'round';
		context.lineJoin = 'round';
		for (const bead of footing.data.beads) {
			const { trail } = bead;
			if (!trail.length) continue;
			const marks = bead.volume > 0 ? [...trail, { at: bead.at, age: 0 }] : trail;
			const thickness = Math.max(0.8, radiusOf(Math.max(bead.volume, DROP_WATER)) * 0.9);
			for (let i = 1; i < marks.length; i++) {
				const fade = 1 - marks[i - 1].age / TRAIL_SECONDS;
				if (fade <= 0) continue;
				const from = pagePoint(footing, marks[i - 1].at, 0.4 / footing.unitY);
				const to = pagePoint(footing, marks[i].at, 0.4 / footing.unitY);
				context.strokeStyle = `rgba(150, 174, 212, ${0.32 * fade})`;
				context.lineWidth = thickness;
				context.beginPath();
				context.moveTo(from.x, from.y);
				context.lineTo(to.x, to.y);
				context.stroke();
			}
		}
		for (const bead of footing.data.beads) {
			if (bead.volume <= 0) continue;
			const shape = beadShape(footing, bead);
			drawWater(context, shape.x, shape.y, shape.rx, shape.ry, shape.angle);
		}
	};

	const drawFalling = (context: CanvasRenderingContext2D): void => {
		for (const drop of falling) {
			const radius = radiusOf(drop.volume);
			const speed = Math.hypot(drop.vx, drop.vy);
			// Drawn out along its way as it gathers speed.
			const stretch = 1 + Math.min(1.6, speed / 500);
			drawWater(context, drop.x, drop.y, radius * stretch, radius / Math.sqrt(stretch), Math.atan2(drop.vy, drop.vx));
		}
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
		frame: ({ context, seconds }) => {
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

			let beaded = false;
			for (const footing of footings.values()) {
				flow(footing, seconds);
				if (!beaded) beaded = footing.data.beads.length > 0;
				drawWet(context, footing);
			}
			drawFalling(context);
			drawSprays(context);
			if (raining) drawDrops(context);
			// Once it's stopped and everything's dried or fallen, it's done.
			return raining || beaded || falling.length > 0 || sprays.length > 0;
		},
	});
	// Each drop lands in the puddle as its fall ends: 2.75s, on average.
	const startPool = () => (weather ? createPool(container, { kind: 'rain', scale, rate: count / (2.75 * speed), fillSeconds, persist, behind: settle }) : undefined);
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
