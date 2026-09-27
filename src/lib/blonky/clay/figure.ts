import {
	armGeometry,
	bellyFolds,
	collarGeometry,
	cuffZigzag,
	densify,
	headGeometry,
	lerp,
	poseAtRest,
	quadratic,
	restingSkinContours,
	tearGeometry,
	TEAR_BEAD_RADIUS,
	TEAR_FRONT_RADIUS,
	tensionArmGeometry,
	torsoGeometry,
	valueNoise,
	waveForearmGeometry,
	wavingArmGeometry,
	winkLid,
	type ArmGeometry,
	type HeadGeometry,
	type Pose,
	type Pt,
} from '../drawing';
import { BLONKY_BUST_HEIGHT, type BlonkyEmotePose } from '../types';

/**
 * Blonky as a clay puppet, rebuilt from the ink pose every exposure.
 *
 * The figure lives in bust units: x right, y down, z toward the camera, and
 * is sculpted the way a puppet is. The shirt is one pressed mass, inflated
 * from the visible shirt: the torso and both sleeves together, less the
 * stretch of body hidden behind each bare arm. So the shoulders and sleeves
 * are continuous clay, and the body rounds away where the arms hang in front
 * of it. Below the armpit each sleeve hangs a little proud of the body: that
 * edge is the drawing's sleeve line. The bare arms come out from under the
 * hems. The head and neck are one mass of skin, as the drawing has them: no
 * jaw line, just jowls running into the neck, which meets the shirt at the
 * collar. The camera looks straight on, so the renderer keeps the
 * frontmost surface at each pixel and lights it, with shadows and occlusion
 * from the real depths.
 */

export const CLAY_COLORS = {
	skin: '#e2cbb3',
	shirt: '#48698f',
	rib: '#42628a',
	eye: '#ebe5d8',
	dark: '#302824',
	stubble: '#3d332d',
	crease: '#7d5a48',
	tear: '#6fa3b1',
	mouth: '#4a2f28',
} as const;

/**
 * Where the large volumes are solved, in bust units at one unit per texel.
 * It runs well past the frame's sides and bottom, so the body and arms carry
 * on out of shot instead of rounding off at the canvas edge.
 */
export const VOLUME_DOMAIN = { x: -140, y: -100, width: 1180, height: 1280 } as const;
const OUT_OF_SHOT = VOLUME_DOMAIN.y + VOLUME_DOMAIN.height - 20;

// Depth of each solid per unit of inflation (1 would be perfectly round),
// and how the pieces sit relative to one another, in bust units.
export const SOLIDS = {
	shirt: {
		zs: 0.85,
		// He's a big man, with a big round belly pushing forward: a dome under
		// the chest. Its outline is an ellipse `width` either side of the
		// middle, fitted so its top runs along the drawing's lower fold, then
		// grown by `spread` so the swell blends out smoothly into the body
		// all round, with no edge. It stands `depth` proud at its middle,
		// below the frame, and swells a little more with each breath in.
		belly: { depth: 220, width: 400, spread: 1.6, breath: 16 },
		// Along the drawing's lower fold the belly tucks in under the chest:
		// a crease `depth` deep, closing steeply `above` the line, and the
		// belly rising gently out of it over `below`. It fades away toward
		// the line's ends, as the drawn line does.
		crease: { depth: 15, above: 26, below: 80 },
		// And the chest is heavy, with the shirt stretched over it: one broad
		// swell across the front, nearly flat along the top, the fabric
		// bridging the breastbone with only a shallow dip. Its peak is `y`
		// below the torso's top middle; it fades up toward the collar over `rise`,
		// and ends `width` either side of the middle, before the sleeves'
		// creases. Below, it eases down into the belly (`sag` near the middle,
		// `sag` far out to the sides).
		chest: { y: 250, width: 205, rise: 130, sag: { near: 150, far: 170 }, cleft: 0.12, depth: 34 },
		// How round each sleeve swells over the arm inside it, per unit of its
		// own inflation, and how softly that swell runs out into the body:
		// the sleeve and body are one piece of clay, with no edge between.
		sleeve: { swell: 0.34, soften: 26 },
		// How far the neckline opens into the body.
		neckline: 14,
	},
	// The head and neck, one mass of skin.
	head: {
		zs: 1.3,
		nose: 24,
		// The chin, and the double chin under it.
		folds: [
			{ depth: 9, radius: 12, reach: 40, below: 16 },
			{ depth: 7, radius: 10, reach: 30, below: 14 },
		],
	},
	arm: {
		// How far each bare arm sits behind the front of its hem.
		tuck: 11,
	},
	// A raised hand is held clear of the chest by this much.
	// A hand is flat for its width: thin fingers inflate round, but the palm
	// eases off toward this thickness.
	hand: { zs: 0.9, thickness: 72, lift: 40 },
} as const;
// Where the head's side meets the neck's flare, clay fills the corner with a
// fillet about this wide, in bust units.
export const HEAD_FILLET = 9;
// The shirt's outline is pressed round, about this much: the sleeves run
// into the body without a seam, and its corners are softened.
export const SHIRT_FILLET = 6;
// Limb cross-sections are round, a little flattened front to back.
export const LIMB_DEPTH = 1.15;
export const LIMB_SAMPLES = 256;

// Frame-to-frame surface drift, in bust units. Stop-motion clay never holds
// its silhouette perfectly between exposures.
const SILHOUETTE_BOIL = 0.55;
// Bristle thickness in the head's local space.
const STUBBLE_WIDTH = 1.2;

type Channel = 0 | 1 | 2;

/** Everything drawn with the 2D canvas API for one exposure. */
export interface ClayLayers {
	/**
	 * Footprints of the large volumes, in bust units over VOLUME_DOMAIN: the
	 * visible shirt (R), the head (G), and a raised hand (B).
	 */
	volumes: HTMLCanvasElement;
	/**
	 * Each sleeve's own footprint (R), over VOLUME_DOMAIN: inflated, it
	 * swells the sleeve round over the arm inside it.
	 */
	sleeves: HTMLCanvasElement;
	/**
	 * Small pieces, in screen space: [collar, cuffs, eye whites],
	 * [brows, stubble, eyelids], [unused, neckline, tears], and the
	 * shapes that set which piece is in front: [head, neck, raised hand].
	 */
	masks: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
	/** Carved detail, in screen space: grooves and ridges. */
	details: [HTMLCanvasElement, HTMLCanvasElement];
	/** Paint, in screen space: the shirt's clay, and the skin's. */
	paint: [HTMLCanvasElement, HTMLCanvasElement];
	/**
	 * The figure's outline, antialiased (R): its blur is the figure's shadow
	 * on the board. And the shirt's outline (G) and every other piece's (B),
	 * which blend the clay's edge into the backdrop.
	 */
	silhouette: HTMLCanvasElement;
}

/**
 * A roll of fat over a drawn fold: above the fold the flesh swells out, then
 * turns under into it on a round lip; below, it's pinched in and eases back
 * out. The roll dies away toward the fold's ends. Units are bust units: how
 * far the roll stands proud, how sharply it turns under, how far its swell
 * reaches up, and how far below the fold the pinch eases out.
 */
export interface RollShape {
	depth: number;
	radius: number;
	reach: number;
	below: number;
}

// Folds per figure (the belly's crease, then the chin's two), and samples
// across each.
export const FOLD_COUNT = 3;
export const FOLD_SAMPLES = 24;

/**
 * A fold's line, sampled at even steps of x between its ends, and the roll
 * of fat over it, if it has one (the belly's top is the lower fold's line).
 */
export interface Fold {
	shape?: RollShape;
	start: number;
	end: number;
	y: number[];
}

/** A round limb. Per sample down its length: centre x, unused, radius, unused. */
export interface Limb {
	top: number;
	bottom: number;
	profile: Float32Array;
}

export interface ClayArm {
	arm: Limb;
	/** Where the arm leaves its hem, and its radius there. */
	hem: { x: number; y: number; radius: number };
	/** The hem's bottom edge: below it the arm is bare and in front. */
	hemLine: [Pt, Pt];
}

export interface ClayFigure {
	/** A raised hand's bounds, if one is raised. */
	hand?: { min: Pt; max: Pt };
	/** Left and right. */
	arms: [ClayArm, ClayArm];
	/** Where the chin overhangs the neckline. */
	chin: Pt;
	/** The torso's top middle, which places the chest and belly. */
	torso: Pt;
	/**
	 * The belly: its outline's centre and half-width and half-height, and
	 * how far it swells forward, breathing.
	 */
	belly: { center: Pt; width: number; height: number; depth: number };
	/** The belly's crease, then the chin's two folds. */
	folds: Fold[];
	/** Rigid offsets that keep surface texture attached to moving pieces. */
	bodyOffset: Pt;
	headOffset: Pt;
}

export function createClayLayers(): ClayLayers {
	const canvas = (): HTMLCanvasElement => document.createElement('canvas');
	return {
		volumes: canvas(),
		sleeves: canvas(),
		masks: [canvas(), canvas(), canvas(), canvas()],
		details: [canvas(), canvas()],
		paint: [canvas(), canvas()],
		silhouette: canvas(),
	};
}

function context(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = 'source-over';
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, width, height);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	return ctx;
}

function channelColor(channel: Channel, amount = 1): string {
	const value = Math.round(Math.max(0, Math.min(1, amount)) * 255);
	return channel === 0 ? `rgb(${value},0,0)` : channel === 1 ? `rgb(0,${value},0)` : `rgb(0,0,${value})`;
}

function path(ctx: CanvasRenderingContext2D, points: Pt[], closed: boolean): void {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
	if (closed) ctx.closePath();
}

function fillCircle(ctx: CanvasRenderingContext2D, center: Pt, radius: number, style: string): void {
	ctx.fillStyle = style;
	ctx.beginPath();
	ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
	ctx.fill();
}

function fillShape(ctx: CanvasRenderingContext2D, points: Pt[], style: string | CanvasGradient): void {
	if (points.length < 3) return;
	ctx.fillStyle = style;
	path(ctx, points, true);
	ctx.fill();
}

function strokeLine(ctx: CanvasRenderingContext2D, points: Pt[], style: string | CanvasGradient, width: number, closed = false): void {
	if (points.length < 2) return;
	ctx.strokeStyle = style;
	ctx.lineWidth = width;
	path(ctx, points, closed);
	ctx.stroke();
}

/**
 * Nudge a contour along its normals with a slowly changing field. Neighboring
 * points stay correlated, so the clay swells and settles rather than jitters.
 */
function boil(points: Pt[], closed: boolean, seed: number, frame: number, amount = SILHOUETTE_BOIL): Pt[] {
	const dense = densify(points, closed, 6);
	if (closed) dense.pop();
	const count = dense.length;
	return dense.map((point, index) => {
		const before = dense[closed ? (index - 1 + count) % count : Math.max(0, index - 1)];
		const after = dense[closed ? (index + 1) % count : Math.min(count - 1, index + 1)];
		const dx = after.x - before.x;
		const dy = after.y - before.y;
		const length = Math.hypot(dx, dy) || 1;
		const drift = (valueNoise(index * 0.16, frame * 0.43, seed) - 0.5) * 2 * amount;
		return { x: point.x - (dy / length) * drift, y: point.y + (dx / length) * drift };
	});
}

/**
 * A rolled coil of clay along a line, as an outline: its width along the
 * line (0 at the start, 1 at the end) comes from `width`, and each end is
 * rounded off.
 */
function coil(points: Pt[], width: (t: number) => number): Pt[] {
	const line = densify(points, false, 0.4);
	const lengths = [0];
	for (let index = 1; index < line.length; index++) {
		lengths.push(lengths[index - 1] + Math.hypot(line[index].x - line[index - 1].x, line[index].y - line[index - 1].y));
	}
	const total = lengths.at(-1) || 1;
	const left: Pt[] = [];
	const right: Pt[] = [];
	const normals = line.map((point, index) => {
		const before = line[Math.max(0, index - 1)];
		const after = line[Math.min(line.length - 1, index + 1)];
		const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
		return { x: -(after.y - before.y) / length, y: (after.x - before.x) / length };
	});
	line.forEach((point, index) => {
		const half = width(lengths[index] / total) / 2;
		const n = normals[index];
		left.push({ x: point.x + n.x * half, y: point.y + n.y * half });
		right.push({ x: point.x - n.x * half, y: point.y - n.y * half });
	});
	// A half circle around each end, from one side to the other.
	const cap = (center: Pt, n: Pt, half: number, from: number): Pt[] => Array.from({ length: 7 }, (_, index) => {
		const angle = Math.atan2(n.y, n.x) + from - (Math.PI * (index + 1)) / 8;
		return { x: center.x + Math.cos(angle) * half, y: center.y + Math.sin(angle) * half };
	});
	return [
		...left,
		...cap(line.at(-1)!, normals.at(-1)!, width(1) / 2, 0),
		...right.reverse(),
		...cap(line[0], normals[0], width(0) / 2, Math.PI),
	];
}

// A brow is rolled fullest in the middle, tapering to its ends; a bristle
// is thick where it's pressed into the scalp and fine at its tip.
const browWidth = (width: number) => (t: number): number => width * (0.62 + 0.5 * Math.sin(Math.PI * t));
const bristleWidth = (t: number): number => STUBBLE_WIDTH * (1.3 - 0.5 * t);

/** Knead a contour: a few passes of a [1 2 1] kernel over its dense points. */
function knead(points: Pt[], closed: boolean, passes: number, step = 4): Pt[] {
	let result = densify(points, closed, step);
	if (closed) result.pop();
	const count = result.length;
	for (let pass = 0; pass < passes; pass++) {
		result = result.map((point, index) => {
			if (!closed && (index === 0 || index === count - 1)) return point;
			const before = result[(index - 1 + count) % count];
			const after = result[(index + 1) % count];
			return {
				x: before.x * 0.25 + point.x * 0.5 + after.x * 0.25,
				y: before.y * 0.25 + point.y * 0.5 + after.y * 0.25,
			};
		});
	}
	return result;
}



/**
 * Sample a fold's line at even steps of x. Even steps let the shader find a
 * pixel's place along the fold directly, and interpolate the line smoothly.
 */
function fold(line: Pt[], shape?: RollShape): Fold {
	const start = line[0].x;
	const end = line.at(-1)!.x;
	const y = Array.from({ length: FOLD_SAMPLES }, (_, index) => {
		const x = start + ((end - start) * index) / (FOLD_SAMPLES - 1);
		const after = Math.max(1, line.findIndex((point) => point.x >= x));
		const a = line[after - 1];
		const b = line[after];
		return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
	});
	return { shape, start, end, y };
}

/**
 * The belly's outline: an ellipse centred on the body's middle, whose top
 * runs through the drawn fold. Its top is the fold's highest point; its
 * height is fitted so it falls away at the fold's ends as the line does.
 */
function bellyDome(fold: Pt[], centerX: number, depth: number): ClayFigure['belly'] {
	const width = SOLIDS.shirt.belly.width;
	const top = Math.min(...fold.map((point) => point.y));
	let fall = 0;
	let reach = 0;
	for (const end of [fold[0], fold.at(-1)!]) {
		const across = Math.min(0.95, Math.abs(end.x - centerX) / width);
		fall += end.y - top;
		reach += 1 - Math.sqrt(1 - across * across);
	}
	const height = fall / reach;
	return { center: { x: centerX, y: top + height }, width, height, depth };
}

function bounds(points: Pt[]): { min: Pt; max: Pt } | undefined {
	if (points.length === 0) return undefined;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return {
		min: { x: Math.min(...xs), y: Math.min(...ys) },
		max: { x: Math.max(...xs), y: Math.max(...ys) },
	};
}

/** Where a drawn edge crosses height y, or undefined if it doesn't. */
function xAt(edge: Pt[], y: number): number | undefined {
	for (let index = 1; index < edge.length; index++) {
		const a = edge[index - 1];
		const b = edge[index];
		if ((y - a.y) * (y - b.y) > 0 || a.y === b.y) continue;
		return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
	}
	return undefined;
}

/** Keep the part of an edge that runs steadily downward from its start. */
function descending(edge: Pt[]): Pt[] {
	const ordered = edge[0].y <= edge.at(-1)!.y ? edge : edge.slice().reverse();
	const result = [ordered[0]];
	for (const point of ordered.slice(1)) {
		if (point.y < result.at(-1)!.y) break;
		result.push(point);
	}
	return result;
}

interface LimbSpec {
	outer: Pt[];
	inner: Pt[];
	top: number;
	bottom: number;
}

/** A round limb whose front outline runs between two drawn edges. */
function limb(spec: LimbSpec): Limb {
	const { outer, inner, top, bottom } = spec;
	const profile = new Float32Array(LIMB_SAMPLES * 4);
	let last: [number, number] | undefined;
	let first = -1;
	for (let index = 0; index < LIMB_SAMPLES; index++) {
		const y = top + ((bottom - top) * index) / (LIMB_SAMPLES - 1);
		const o = xAt(outer, y);
		const i = xAt(inner, y);
		if (o !== undefined && i !== undefined) {
			last = [(o + i) / 2, Math.abs(o - i) / 2];
			if (first < 0) first = index;
		}
		if (last) profile.set([last[0], 0, last[1], 0], index * 4);
	}
	// Carry the first full cross-section up over any stretch above it.
	for (let index = 0; index < first; index++) {
		profile.set(profile.subarray(first * 4, first * 4 + 4), index * 4);
	}
	// Roll the limb smooth along its length: the drawn edges' tremble would
	// otherwise ring it with ridges.
	const rolled = profile.slice();
	const reach = 14;
	for (let index = 0; index < LIMB_SAMPLES; index++) {
		let x = 0;
		let r = 0;
		let weight = 0;
		for (let offset = -reach; offset <= reach; offset++) {
			const sample = Math.max(0, Math.min(LIMB_SAMPLES - 1, index + offset));
			const w = reach + 1 - Math.abs(offset);
			x += profile[sample * 4] * w;
			r += profile[sample * 4 + 2] * w;
			weight += w;
		}
		rolled[index * 4] = x / weight;
		rolled[index * 4 + 2] = r / weight;
	}
	return { top, bottom, profile: rolled };
}

// How far each bare arm carries on up inside its sleeve, in bust units.
const ARM_IN_SLEEVE = 40;

/** Carry an arm's edge, which starts at its hem, on up inside the sleeve. */
function intoSleeve(edge: Pt[]): Pt[] {
	const [first, second] = edge;
	const length = Math.hypot(first.x - second.x, first.y - second.y) || 1;
	const reach = ARM_IN_SLEEVE / length;
	return [{ x: first.x + (first.x - second.x) * reach, y: first.y + (first.y - second.y) * reach }, ...edge];
}

/** Carry a shape's flat bottom edge, drawn just below the frame, on out of shot. */
function continueOutOfShot(points: Pt[]): Pt[] {
	const hem = Math.max(...points.map((point) => point.y));
	if (hem <= BLONKY_BUST_HEIGHT) return points;
	const index = points.findIndex((point, i) => (
		point.y === hem && points[(i + 1) % points.length].y === hem
	));
	if (index < 0) return points;
	const next = points[(index + 1) % points.length];
	return [
		...points.slice(0, index + 1),
		{ x: points[index].x, y: OUT_OF_SHOT },
		{ x: next.x, y: OUT_OF_SHOT },
		...points.slice(index + 1),
	];
}

function cuffBand(arm: ArmGeometry): Pt[] {
	return [arm.cuffUpper[0], arm.cuffUpper[1], arm.cuffLower[1], arm.cuffLower[0]];
}

function applyHead(ctx: CanvasRenderingContext2D, head: HeadGeometry): void {
	ctx.translate(head.pivot.x, head.pivot.y);
	ctx.rotate(head.angle);
	ctx.translate(head.offset.x, head.offset.y);
	ctx.scale(head.scale.x, head.scale.y);
}

/** Map a point from head space (or face space) into bust units. */
function headToBust(head: HeadGeometry, point: Pt, face = false): Pt {
	const local = face ? { x: point.x + head.face.x, y: point.y + head.face.y } : point;
	const x = head.offset.x + head.scale.x * local.x;
	const y = head.offset.y + head.scale.y * local.y;
	const cos = Math.cos(head.angle);
	const sin = Math.sin(head.angle);
	return { x: head.pivot.x + x * cos - y * sin, y: head.pivot.y + x * sin + y * cos };
}

/** Grow an eye outline so the lid rim overlaps the white bead. */
function swell(points: Pt[], center: Pt, amount: number): Pt[] {
	return points.map((point) => {
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		const length = Math.hypot(dx, dy) || 1;
		return { x: point.x + (dx / length) * amount, y: point.y + (dy / length) * amount };
	});
}

/** A drawn crease, pressed into clay: the ink's straight segments become a
 * smooth curve (Chaikin corner cutting, which keeps the ends in place). */
function crease(line: Pt[]): Pt[] {
	let points = line;
	for (let pass = 0; pass < 5; pass++) {
		const next: Pt[] = [points[0]];
		for (let index = 0; index < points.length - 1; index++) {
			const a = points[index];
			const b = points[index + 1];
			next.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
		}
		next.push(points.at(-1)!);
		points = next;
	}
	return points;
}

/**
 * Round off a drawn outline the way pressed clay would: its polygon becomes
 * a smooth curve through the drawing's points, except at its true corners
 * (where it turns more than `corner`, about 45 degrees), which stay put.
 */
function roundOff(outline: Pt[], corner = Math.PI / 4): Pt[] {
	const count = outline.length;
	const corners = outline.flatMap((point, index) => {
		const before = outline[(index - 1 + count) % count];
		const after = outline[(index + 1) % count];
		const ax = point.x - before.x;
		const ay = point.y - before.y;
		const bx = after.x - point.x;
		const by = after.y - point.y;
		const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
		return turn > corner ? [index] : [];
	});
	if (corners.length === 0) return crease([...outline, outline[0]]).slice(0, -1);
	return corners.flatMap((corner, index) => {
		const next = corners[(index + 1) % corners.length];
		const chain: Pt[] = [];
		for (let i = corner; ; i = (i + 1) % count) {
			chain.push(outline[i]);
			if (chain.length > 1 && i === next) break;
		}
		return crease(chain).slice(0, -1);
	});
}

function noseShape(nose: Pt[]): Pt[] {
	// The ink nose is one contour: the shadowed bridge and the base. Close it
	// through the lit side so the clay has a body to catch light.
	const [bridge, , , , , , base] = nose;
	return [
		...nose,
		{ x: base.x + 3, y: base.y - 9 },
		{ x: base.x + 15, y: base.y - 24 },
		{ x: bridge.x - 7, y: bridge.y + 4 },
	];
}

function ellipse(center: Pt, rx: number, ry: number, count = 20): Pt[] {
	return Array.from({ length: count }, (_, index) => {
		const angle = (index / count) * Math.PI * 2;
		return { x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry };
	});
}

interface SculptOptions {
	emote?: BlonkyEmotePose;
	/** Bust-space origin and scale for the current view, in canvas pixels. */
	origin: Pt;
	pxPerUnit: number;
	width: number;
	height: number;
	frame: number;
}

export function sculptBlonky(layers: ClayLayers, time: number, options: SculptOptions): ClayFigure {
	const { frame, origin, pxPerUnit: k, width, height } = options;
	const pose: Pose = poseAtRest(time, options.emote);
	const collar = collarGeometry(pose);
	const [leftArm, rightArm] = ([-1, 1] as const).map((side) => wavingArmGeometry(
		tensionArmGeometry(armGeometry(pose, side), pose.armTension),
		pose,
	));
	const torso = torsoGeometry(pose, collar, leftArm, rightArm);
	const head = headGeometry(pose);

	// Body outlines, in bust units. The torso's outline runs across the neck
	// opening: the neckline is pressed into the shirt, not cut out of it.
	const torsoOutline = boil(knead(continueOutOfShot(torso.outline), true, 12), true, 901, frame);
	const torsoShape = boil(continueOutOfShot(torso.surface), true, 901, frame);
	const chestShape = boil(collar.chestSkin, true, 903, frame);
	const collarShape = boil(collar.edge.concat(collar.seam.slice().reverse()), true, 905, frame, SILHOUETTE_BOIL * 0.5);

	const arms = [leftArm, rightArm].map((arm, index) => {
		const wave = arm.wave ? waveForearmGeometry(arm) : undefined;
		const skin = restingSkinContours(arm);
		// The drawing trembles the arm's radius from sample to sample; the
		// clay arm is smooth and round, so its edges are kneaded well out.
		// Its volume and its outline both follow these same edges.
		// And the arm carries on up inside its sleeve, as a real arm does, so
		// there's always arm under the hem, however the sleeve's edge rounds.
		const outer = knead(intoSleeve(wave ? wave.upperOuter : [...skin.outer, { x: skin.outer.at(-1)!.x, y: OUT_OF_SHOT }]), false, 60);
		const inner = knead(intoSleeve(wave
			? wave.upperSkin.slice(wave.upperOuter.length).reverse()
			: [...skin.inner, { x: skin.inner.at(-1)!.x, y: OUT_OF_SHOT }]), false, 60);
		return {
			geometry: arm,
			armpit: arm.innerContour[0],
			outer: boil(wave ? descending(outer) : outer, false, 911 + index, frame),
			inner: boil(wave ? descending(inner) : inner, false, 913 + index, frame),
			paintSkin: boil([...outer, ...inner.slice().reverse()], true, 911 + index, frame),
			sleeve: boil(knead(roundOff(arm.sleeveSurface), true, 8), true, 915 + index, frame),
			cuff: boil(cuffBand(arm), true, 919 + index, frame, SILHOUETTE_BOIL * 0.5),
			// The rib's teeth run between the band's edges, inset to stay on it.
			zigzag: cuffZigzag(
				lerp(arm.cuffUpper[0], arm.cuffLower[0], 0.15),
				lerp(arm.cuffUpper[1], arm.cuffLower[1], 0.15),
				lerp(arm.cuffUpper[0], arm.cuffLower[0], 0.8),
				lerp(arm.cuffUpper[1], arm.cuffLower[1], 0.8),
			),
			hand: wave && {
				// Pressed round: fingertips and the webs between fingers.
				silhouette: boil(roundOff(wave.hand.concat(wave.forearm.slice(1, -1).reverse()), Math.PI), true, 925 + index, frame, SILHOUETTE_BOIL * 0.6),
				creases: [wave.wristCrease, wave.forearmFold],
				palm: wave.palmCrease,
				fingers: arm.wave!.fingers,
			},
		};
	});

	// Each bare arm hangs from inside its sleeve and comes out under the hem.
	const clayArms = arms.map((arm): ClayArm => {
		const { geometry } = arm;
		const cuffTop = Math.min(geometry.cuffUpper[0].y, geometry.cuffUpper[1].y);
		const hemY = Math.max(geometry.cuffLower[0].y, geometry.cuffLower[1].y);
		const o = xAt(arm.outer, hemY + 4) ?? arm.outer[0].x;
		const i = xAt(arm.inner, hemY + 4) ?? arm.inner[0].x;
		return {
			arm: limb({
				outer: arm.outer,
				inner: arm.inner,
				top: cuffTop - 20,
				bottom: Math.min(arm.outer.at(-1)!.y, arm.inner.at(-1)!.y),
			}),
			hem: { x: (o + i) / 2, y: (cuffTop + hemY) / 2, radius: Math.abs(o - i) / 2 },
			hemLine: [geometry.cuffLower[0], geometry.cuffLower[1]],
		};
	});

	// Head, in its own drawing space.
	const headBoil = SILHOUETTE_BOIL / 2;
	// Pressed clay rounds the drawing's corners: the skull's outline is a
	// polygon of a couple of dozen points.
	const skull = boil(knead(head.skull, true, 14, 2), true, 931, frame, headBoil);
	const eyes = [
		{ open: head.leftEyeOpen, shape: head.leftEye, center: head.leftEyeCenter, closed: head.leftEyeClosed, wink: pose.leftWink, radius: 12, side: -1 as const, seed: 941 },
		{ open: head.rightEyeOpen, shape: head.rightEye, center: head.rightEyeCenter, closed: head.rightEyeClosed, wink: pose.rightWink, radius: 10, side: 1 as const, seed: 943 },
	].map((eye) => ({
		...eye,
		white: boil(knead(eye.shape, true, 3, 1.5), true, eye.seed, frame, headBoil * 0.3),
		lid: knead(swell(eye.open, eye.center, 1.9), true, 3, 1.5),
		// A winked eye shuts along one arch rather than a flattened outline.
		winked: eye.closed && eye.wink > 0 ? winkLid(eye.center, eye.radius, eye.side) : undefined,
	}));
	const brows = [
		{ points: head.leftBrow, width: 2.6, seed: 951 },
		{ points: head.rightBrow, width: 2.4, seed: 952 },
	].map((brow) => {
		const points = boil(knead(brow.points, false, 2, 1.5), false, brow.seed, frame, headBoil * 0.4);
		return { ...brow, points, coil: coil(points, browWidth(brow.width)) };
	});
	const bristles = head.hairs.map((hair) => coil(hair.points, bristleWidth));
	const tears = tearGeometry(pose, head, frame);
	const tearWells = tears.wells.map((well) => ({
		eye: well.eye,
		amount: well.amount,
		water: [
			{ x: well.outerX, y: well.bottom + 1 },
			...quadratic(well.waterline[0], well.waterline[1], well.waterline[2], 8),
			{ x: well.innerX + well.innerSide, y: well.bottom + 1 },
		],
		bead: well.bead,
	}));

	const screen = (ctx: CanvasRenderingContext2D): void => {
		ctx.setTransform(k, 0, 0, k, origin.x, origin.y);
	};
	const bust = (ctx: CanvasRenderingContext2D): void => {
		ctx.setTransform(1, 0, 0, 1, -VOLUME_DOMAIN.x, -VOLUME_DOMAIN.y);
	};
	const spaces = new Map<CanvasRenderingContext2D, typeof screen>();
	const layer = (canvas: HTMLCanvasElement, space: typeof screen, additive: boolean): CanvasRenderingContext2D => {
		const ctx = space === bust
			? context(canvas, VOLUME_DOMAIN.width, VOLUME_DOMAIN.height)
			: context(canvas, width, height);
		if (additive) ctx.globalCompositeOperation = 'lighter';
		space(ctx);
		spaces.set(ctx, space);
		return ctx;
	};
	const withHead = (ctx: CanvasRenderingContext2D, draw: () => void, face = true): void => {
		ctx.save();
		spaces.get(ctx)!(ctx);
		applyHead(ctx, head);
		if (face) ctx.translate(head.face.x, head.face.y);
		draw();
		ctx.restore();
	};
	const drawTears = (ctx: CanvasRenderingContext2D, style: (amount: number) => string): void => {
		for (const well of tearWells) {
			ctx.save();
			path(ctx, well.eye, true);
			ctx.clip();
			fillShape(ctx, well.water, style(well.amount));
			fillCircle(ctx, well.bead, TEAR_BEAD_RADIUS, style(well.amount));
			ctx.restore();
		}
		for (const track of tears.tracks) {
			fillShape(ctx, track.mark, style(1));
			fillCircle(ctx, track.front, TEAR_FRONT_RADIUS * 1.3, style(1));
		}
	};

	// Footprints of the large volumes. The shirt is the torso and sleeves
	// together, as one mass; additive fills saturate where they overlap. The
	// body behind each bare arm is hidden, so it isn't part of the mass.
	const volumes = layer(layers.volumes, bust, true);
	fillShape(volumes, torsoOutline, channelColor(0));
	for (const arm of arms) fillShape(volumes, arm.sleeve, channelColor(0));
	// The cut is the clay arm's own silhouette, below its hem, so the arm and
	// the body behind it meet exactly.
	volumes.globalCompositeOperation = 'destination-out';
	clayArms.forEach(({ arm, hemLine: [a, b] }) => {
		const left: Pt[] = [];
		const right: Pt[] = [];
		for (let index = 0; index < LIMB_SAMPLES; index++) {
			const y = arm.top + ((arm.bottom - arm.top) * index) / (LIMB_SAMPLES - 1);
			const x = arm.profile[index * 4];
			const r = arm.profile[index * 4 + 2];
			left.push({ x: x - r, y });
			right.push({ x: x + r, y });
		}
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const reach = 4000 / Math.hypot(dx, dy);
		volumes.save();
		path(volumes, [
			{ x: a.x - dx * reach, y: a.y - dy * reach },
			{ x: b.x + dx * reach, y: b.y + dy * reach },
			{ x: b.x + dx * reach, y: OUT_OF_SHOT + 4000 },
			{ x: a.x - dx * reach, y: OUT_OF_SHOT + 4000 },
		], true);
		volumes.clip();
		fillShape(volumes, [...left, ...right.reverse()], '#000');
		volumes.restore();
	});
	volumes.globalCompositeOperation = 'lighter';
	withHead(volumes, () => fillShape(volumes, skull, channelColor(1)), false);
	fillShape(volumes, chestShape, channelColor(1));
	for (const arm of arms) if (arm.hand) fillShape(volumes, arm.hand.silhouette, channelColor(2));
	const sleeves = layer(layers.sleeves, bust, true);
	for (const arm of arms) fillShape(sleeves, arm.sleeve, channelColor(0));

	// Small pieces.
	const [m0, m1, m2, m3] = layers.masks.map((canvas) => layer(canvas, screen, true));
	fillShape(m0, collarShape, channelColor(0));
	for (const arm of arms) fillShape(m0, arm.cuff, channelColor(1));
	withHead(m0, () => {
		for (const eye of eyes) if (!eye.closed) fillShape(m0, eye.white, channelColor(2));
	});
	withHead(m1, () => {
		for (const brow of brows) fillShape(m1, brow.coil, channelColor(0));
		for (const eye of eyes) fillShape(m1, eye.lid, channelColor(2));
	});
	withHead(m1, () => {
		for (const bristle of bristles) fillShape(m1, bristle, channelColor(1));
	}, false);
	fillShape(m2, chestShape, channelColor(1));
	withHead(m2, () => drawTears(m2, () => channelColor(2)));
	// Which piece is in front is decided by these drawn shapes, not by
	// comparing depths at their thin edges: the head over everything, the
	// collar over the neck, the neck over the shirt, a raised hand in front.
	withHead(m3, () => fillShape(m3, skull, channelColor(0)), false);
	fillShape(m3, chestShape, channelColor(1));
	for (const arm of arms) if (arm.hand) fillShape(m3, arm.hand.silhouette, channelColor(2));

	// Detail: [fine grooves, fine ridges, soft grooves] and [soft ridges,
	// broad swells].
	const [d0, d1] = layers.details.map((canvas) => layer(canvas, screen, true));
	for (const arm of arms) {
		// The rib pattern stays within its band.
		d0.save();
		path(d0, arm.cuff, true);
		d0.clip();
		strokeLine(d0, arm.zigzag, channelColor(0, 0.9), 1.9);
		d0.restore();
		// The crease where the sleeve hangs against the body: the drawing's
		// line from the armpit down to the hem. It eases in below the armpit,
		// where the sleeve parts from the body; above, they're one piece.
		const line = arm.geometry.innerContour;
		const top = line[0].y;
		const bottom = line.at(-1)!.y;
		for (const [channel, amount, width] of [[2, 1, 6], [0, 0.8, 1.6]] as const) {
			const fade = d0.createLinearGradient(0, top, 0, top + (bottom - top) * 0.15);
			fade.addColorStop(0, channelColor(channel, 0));
			fade.addColorStop(1, channelColor(channel, amount));
			strokeLine(d0, line, fade, width);
		}
	}
	// The belly is sculpted in the shader; its crease closes to a fine line.
	// The drawing's short upper line is a sketch of the chest's weight; in
	// clay the belly's crease, its lower line, carries that on its own.
	const [, lowerFold] = bellyFolds(pose);
	strokeLine(d0, lowerFold, channelColor(0, 0.45), 1.8);
	strokeLine(d0, collar.seam, channelColor(0, 0.9), 2);
	withHead(d0, () => {
		strokeLine(d0, head.mouth, channelColor(0, 1), 1.5);
		strokeLine(d0, head.lowerLip, channelColor(0, 0.5), 0.9);
		strokeLine(d0, crease(head.leftUnderEye), channelColor(0, 0.7), 1.0);
		strokeLine(d0, crease(head.rightUnderEye), channelColor(0, 0.65), 0.95);
		// The crease under the nose, where its base meets the lip.
		strokeLine(d0, crease(head.nose.slice(3)), channelColor(0, 0.45), 1.1);
		strokeLine(d0, crease(head.chin), channelColor(0, 0.8), 1.2);
		strokeLine(d0, crease(head.lowerChin), channelColor(0, 0.55), 1.0);
		for (const eye of eyes) {
			if (eye.winked) {
				strokeLine(d0, eye.winked.lid, channelColor(0, 1), 1.3);
				strokeLine(d0, eye.winked.tick, channelColor(0, 0.6), 0.9);
			} else {
				strokeLine(d0, eye.white, channelColor(0, eye.closed ? 0.9 : 0.5), eye.closed ? 1.1 : 0.8, true);
			}
		}
	});
	withHead(d1, () => {
		// The nose, as its own soft mound: blurred, it rises from the face and
		// is fullest down at its base.
		fillShape(d1, knead(noseShape(head.nose), true, 8, 1.5), channelColor(2, 1));
		// Lower lip, cheeks, and the double chin's rolls.
		fillShape(d1, ellipse({ x: -12, y: 19 }, 13, 3.4), channelColor(0, 0.5));
		fillShape(d1, ellipse({ x: -40, y: -18 }, 16, 12), channelColor(1, 0.8));
		fillShape(d1, ellipse({ x: 36, y: -14 }, 14, 11), channelColor(1, 0.7));
		fillShape(d1, [...crease(head.chin), ...crease(head.lowerChin).reverse()], channelColor(0, 0.4));
		fillShape(d1, ellipse({ x: -33, y: -39 }, 12, 3), channelColor(0, 0.3));
		fillShape(d1, ellipse({ x: 31, y: -35 }, 10, 2.6), channelColor(0, 0.28));
	});
	for (const arm of arms) {
		if (!arm.hand) continue;
		const { silhouette, creases, palm, fingers } = arm.hand;
		// A raised hand covers whatever was carved behind it.
		for (const ctx of [d0, d1]) {
			ctx.globalCompositeOperation = 'destination-out';
			fillShape(ctx, silhouette, '#000');
			ctx.globalCompositeOperation = 'lighter';
		}
		for (const crease of creases) strokeLine(d0, crease, channelColor(0, 0.55), 1.4);
		strokeLine(d0, palm, channelColor(0, fingers * 0.5), 1.4);
	}

	// Paint, back to front like the ink drawing, one layer per clay: each
	// piece takes its colour from its own clay's layer, so no piece picks up
	// another's colour along their shared edge. A wide backing under each
	// outline keeps a clay's own colour right out to its rounded edge.
	const shirtPaint = layer(layers.paint[0], screen, false);
	strokeLine(shirtPaint, torsoShape, CLAY_COLORS.shirt, 10, true);
	for (const arm of arms) strokeLine(shirtPaint, arm.sleeve, CLAY_COLORS.shirt, 10, true);
	fillShape(shirtPaint, torsoShape, CLAY_COLORS.shirt);
	fillShape(shirtPaint, collarShape, CLAY_COLORS.rib);
	for (const arm of arms) {
		fillShape(shirtPaint, arm.sleeve, CLAY_COLORS.shirt);
		fillShape(shirtPaint, arm.cuff, CLAY_COLORS.rib);
	}

	const skinPaint = layer(layers.paint[1], screen, false);
	for (const arm of arms) strokeLine(skinPaint, arm.paintSkin, CLAY_COLORS.skin, 10, true);
	strokeLine(skinPaint, chestShape, CLAY_COLORS.skin, 10, true);
	fillShape(skinPaint, chestShape, CLAY_COLORS.skin);
	for (const arm of arms) fillShape(skinPaint, arm.paintSkin, CLAY_COLORS.skin);
	withHead(skinPaint, () => {
		strokeLine(skinPaint, skull, CLAY_COLORS.skin, 5, true);
		fillShape(skinPaint, skull, CLAY_COLORS.skin);
	}, false);
	withHead(skinPaint, () => {
		for (const eye of eyes) {
			if (!eye.closed) fillShape(skinPaint, eye.white, CLAY_COLORS.eye);
			// The drawing's heavy eye outline, as a dark lash line in the lid.
			skinPaint.globalAlpha = eye.closed ? 0.75 : 0.9;
			if (eye.winked) {
				strokeLine(skinPaint, eye.winked.lid, CLAY_COLORS.dark, 1.2);
				skinPaint.globalAlpha = 0.45;
				strokeLine(skinPaint, eye.winked.tick, CLAY_COLORS.dark, 0.7);
			} else {
				strokeLine(skinPaint, eye.white, CLAY_COLORS.dark, eye.closed ? 1.4 : 1.6, true);
			}
			skinPaint.globalAlpha = 1;
		}
		for (const brow of brows) fillShape(skinPaint, brow.coil, CLAY_COLORS.dark);
		skinPaint.globalAlpha = 0.9;
		strokeLine(skinPaint, head.mouth, CLAY_COLORS.mouth, 1.0);
		skinPaint.globalAlpha = 0.2;
		for (const line of [head.leftUnderEye, head.rightUnderEye, head.chin, head.lowerChin, head.nose]) {
			strokeLine(skinPaint, line, CLAY_COLORS.crease, 1);
		}
		skinPaint.globalAlpha = 1;
		// Clear, wet tears: tinted just enough to read against skin and eye.
		drawTears(skinPaint, (amount) => {
			skinPaint.globalAlpha = Math.min(1, amount) * 0.6;
			return CLAY_COLORS.tear;
		});
		skinPaint.globalAlpha = 1;
	});
	withHead(skinPaint, () => {
		for (const bristle of bristles) fillShape(skinPaint, bristle, CLAY_COLORS.stubble);
	}, false);
	for (const arm of arms) {
		if (!arm.hand) continue;
		strokeLine(skinPaint, arm.hand.silhouette, CLAY_COLORS.skin, 6, true);
		fillShape(skinPaint, arm.hand.silhouette, CLAY_COLORS.skin);
	}

	// The outline: every visible piece's true edge, with no backing (R); the
	// shirt's alone (G), which is pressed round; and every other piece's (B).
	const outline = layer(layers.silhouette, screen, true);
	const piece = 'rgb(255,0,255)';
	const shirt = 'rgb(255,255,0)';
	fillShape(outline, torsoOutline, shirt);
	fillShape(outline, chestShape, piece);
	for (const arm of arms) {
		fillShape(outline, arm.paintSkin, piece);
		fillShape(outline, arm.sleeve, shirt);
		if (arm.hand) fillShape(outline, arm.hand.silhouette, piece);
	}
	withHead(outline, () => {
		fillShape(outline, skull, piece);
		for (const bristle of bristles) fillShape(outline, bristle, piece);
	}, false);

	return {
		hand: bounds(arms.flatMap((arm) => arm.hand?.silhouette ?? [])),
		arms: [clayArms[0], clayArms[1]],
		chin: headToBust(head, { x: 0, y: 70 }),
		torso: { x: pose.centerX, y: pose.torsoY },
		belly: bellyDome(lowerFold, pose.centerX, SOLIDS.shirt.belly.depth + pose.breath * SOLIDS.shirt.belly.breath),
		folds: [
			fold(lowerFold),
			fold(crease(head.chin).map((point) => headToBust(head, point, true)), SOLIDS.head.folds[0]),
			fold(crease(head.lowerChin).map((point) => headToBust(head, point, true)), SOLIDS.head.folds[1]),
		],
		bodyOffset: { x: pose.centerX - 450, y: pose.torsoY - 294 },
		headOffset: { x: pose.headX - 445, y: pose.headY - 295 },
	};
}

/** Stable per-frame lighting flicker, the signature of a stop-motion exposure. */
export function exposureFlicker(frame: number): number {
	return (valueNoise(frame * 0.9, 0.5, 977) - 0.5) * 0.035;
}
