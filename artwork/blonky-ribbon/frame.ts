// One frame of the Blonky ribbon GIF: Blonky idling in a hand-drawn circle, with a
// "crapshack" ribbon across his belly. render.mjs bundles this for a headless
// browser and draws every frame of the loop with it.
import { poseAtRest, type Pose } from '../../src/lib/blonky/geometry';
import { blinkPoseAt } from '../../src/lib/blonky/motion';
import { drawUpperBody } from '../../src/lib/blonky/ink/body';
import { drawHead } from '../../src/lib/blonky/ink/head';
import { DEFAULT_BLONKY_PALETTE } from '../../src/lib/blonky/ink/palette';
import { hash, valueNoise } from '../../src/lib/blonky/noise';
import { beginInkFrame, fill, hatch, polygonPath, stipple, stroke } from '../../src/lib/blonky/ink/pen';
import { BLONKY_FPS } from '../../src/lib/blonky/types';

type P = { x: number; y: number };

/** Nine seconds holds one full blink phrase: a double blink, then a single one. */
const LOOP_SECONDS = 9;
export const FPS = BLONKY_FPS;
export const FRAMES = Math.round(LOOP_SECONDS * FPS);

// Everything is laid out in his own 900 × 800 bust units, so every line weight is his.
const CIRCLE = { x: 450, y: 365, r: 360 };
// How freehand the ribbon is: 0 is nearly geometric.
const HAND = 1;
// How far the circle strays from round: 0 is a true circle.
const CIRCLE_HAND = 1;
// How freehand the lettering is: 0 is steady to the point of looking typeset.
const LETTER_HAND = 1;
// The site's light canvas blue.
const DISC = '#67a3d9';
const TEXT = 'crapshack';
const RIBBON_FACE = '#fdd0e0';
const RIBBON_SHADE = '#9a4f6a';
// Speckle on the ribbon, as his shirt has its own.
const RIBBON_TEXTURE = '#c9849e';
// His face is drawn at about twice his body's scale; the lettering uses the same.
const FACE_SCALE = 2;
// The ribbon bends along a big circle, a gentle smile across his belly. Its
// centreline crosses his middle at y = 623.
const RIBBON = { x: CIRCLE.x, y: 623 - 950, R: 950, half: 52 };
// Along the bend, in radians: the front band's ends, where the tails start
// under it and stop, how far the tails sit below it, and the V cut in their ends.
const RIBBON_SHAPE = { end: 0.34, tailIn: 0.27, tailOut: 0.45, drop: RIBBON.half * 0.78, notch: 0.045 };

type Blendable = number | Blendable[] | { [key: string]: Blendable } | undefined;

function blend(a: Blendable, b: Blendable, w: number): Blendable {
	if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * w;
	if (Array.isArray(a) && Array.isArray(b)) return a.map((value, index) => blend(value, b[index], w));
	if (a && typeof a === 'object' && b && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
		const out: { [key: string]: Blendable } = {};
		for (const key of Object.keys(a)) out[key] = blend(a[key], b[key], w);
		return out;
	}
	return a;
}

/**
 * His idle pose, made to loop: it eases from f(t) into f(t - loop), so the
 * last frame leads into the first. Blinks are kept as drawn, since a blend
 * would leave them half shut.
 */
function loopPose(time: number): Pose {
	const pose = blend(
		poseAtRest(time) as unknown as Blendable,
		poseAtRest(time - LOOP_SECONDS) as unknown as Blendable,
		time / LOOP_SECONDS,
	) as unknown as Pose;
	const { leftEyeOpen, rightEyeOpen } = blinkPoseAt(time);
	pose.leftEyeOpen = leftEyeOpen;
	pose.rightEyeOpen = rightEyeOpen;
	return pose;
}

/** A freehand circle: a little squashed and tilted, with lumps and flat spots. */
function circlePoints(r: number): P[] {
	const points: P[] = [];
	const steps = 96;
	for (let i = 0; i < steps; i++) {
		const a = (i / steps) * Math.PI * 2;
		const lumps = CIRCLE_HAND * (
			0.035 * Math.cos(2 * (a - 0.5))
			+ 0.014 * Math.sin(a * 3 + 2.1)
			+ 0.008 * Math.sin(a * 4 + 0.9)
			+ 0.005 * Math.sin(a * 5 + 4.2)
		);
		const rr = r * (1 + lumps);
		points.push({ x: CIRCLE.x + Math.cos(a) * rr, y: CIRCLE.y + Math.sin(a) * rr });
	}
	return points;
}

function arcStroke(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): P[] {
	const points: P[] = [];
	for (let i = 0; i <= 14; i++) {
		const a = a0 + ((a1 - a0) * i) / 14;
		points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
	}
	return points;
}

// Single-stroke capitals in a box one unit tall, a little condensed, as a
// practised hand letters a sign; each glyph is a list of strokes.
const GLYPHS: Record<string, { w: number; strokes: P[][] }> = {
	C: { w: 0.6, strokes: [arcStroke(0.33, 0.5, 0.33, 0.5, -0.85, -5.43)] },
	R: {
		w: 0.56,
		strokes: [
			[{ x: 0, y: 1 }, { x: 0, y: 0 }],
			[{ x: 0, y: 0 }, { x: 0.32, y: 0 }, { x: 0.48, y: 0.06 }, { x: 0.54, y: 0.2 }, { x: 0.5, y: 0.36 }, { x: 0.34, y: 0.47 }, { x: 0, y: 0.48 }],
			[{ x: 0.26, y: 0.48 }, { x: 0.56, y: 1 }],
		],
	},
	A: {
		w: 0.62,
		strokes: [
			[{ x: 0, y: 1 }, { x: 0.31, y: 0 }, { x: 0.62, y: 1 }],
			[{ x: 0.13, y: 0.64 }, { x: 0.49, y: 0.64 }],
		],
	},
	P: {
		w: 0.54,
		strokes: [
			[{ x: 0, y: 1 }, { x: 0, y: 0 }],
			[{ x: 0, y: 0 }, { x: 0.32, y: 0 }, { x: 0.48, y: 0.06 }, { x: 0.54, y: 0.22 }, { x: 0.49, y: 0.39 }, { x: 0.32, y: 0.5 }, { x: 0, y: 0.5 }],
		],
	},
	S: {
		w: 0.54,
		strokes: [[
			...arcStroke(0.27, 0.25, 0.25, 0.25, -0.45, -Math.PI * 1.5),
			...arcStroke(0.27, 0.75, 0.27, 0.25, -Math.PI / 2, Math.PI + 0.4).slice(1),
		]],
	},
	H: {
		w: 0.56,
		strokes: [
			[{ x: 0, y: 0 }, { x: 0, y: 1 }],
			[{ x: 0.56, y: 0 }, { x: 0.56, y: 1 }],
			[{ x: 0, y: 0.5 }, { x: 0.56, y: 0.5 }],
		],
	},
	K: {
		w: 0.56,
		strokes: [
			[{ x: 0, y: 0 }, { x: 0, y: 1 }],
			[{ x: 0.54, y: 0 }, { x: 0.02, y: 0.58 }],
			[{ x: 0.19, y: 0.4 }, { x: 0.57, y: 1 }],
		],
	},
};

// The ribbon is hand cut: its edges wander a little, and its two ends don't
// quite mirror each other.
function wander(theta: number, seed: number, wavelength: number, amount: number): number {
	return (valueNoise((theta * RIBBON.R) / wavelength, 0.5, seed) - 0.5) * amount;
}

/** A point on the ribbon: theta 0 is straight down its bend, offset is downward from its centreline. */
function onRibbon(theta: number, offset: number): P {
	const r = RIBBON.R + offset + wander(theta, 7831, 260, 9 * (1 + HAND));
	return { x: RIBBON.x + Math.sin(theta) * r, y: RIBBON.y + Math.cos(theta) * r };
}

/** The ribbon's top edge (-1) or bottom edge (1), shifted down by shift, at theta. */
function ribbonEdge(theta: number, edge: -1 | 1, shift: number): P {
	const seed = edge < 0 ? 7811 : 7823;
	return onRibbon(theta, shift + edge * (RIBBON.half + wander(theta, seed, 85, 7 * (1 + 0.6 * HAND))));
}

/** A length of ribbon: its top edge from t0 to t1, then its bottom edge back from b1 to b0. */
function band(t0: number, t1: number, shift: number, b0 = t0, b1 = t1, steps = 24): P[] {
	const top: P[] = [];
	const bottom: P[] = [];
	for (let i = 0; i <= steps; i++) {
		top.push(ribbonEdge(t0 + ((t1 - t0) * i) / steps, -1, shift));
		bottom.push(ribbonEdge(b0 + ((b1 - b0) * i) / steps, 1, shift));
	}
	return [...top, ...bottom.reverse()];
}

/** Each end's own measurements, a touch different side to side. */
function ribbonSide(side: -1 | 1) {
	const left = side < 0;
	const { end, tailIn, tailOut, drop, notch } = RIBBON_SHAPE;
	return {
		end: end * (left ? 0.985 : 1.02),
		// The cut at the end of the front leans a little, rather than running square.
		endTop: (left ? 0.004 : 0.007) * (1 + 1.5 * HAND),
		endBottom: (left ? -0.006 : -0.003) * (1 + 1.5 * HAND),
		// The fold's outer edge leans too, instead of dropping plumb.
		foldLean: (left ? 0.006 : -0.004) * HAND,
		tailIn,
		tailOut: tailOut * (left ? 1.03 : 0.97),
		drop: drop * (left ? 1 : 0.88),
		notch: notch * (left ? 1.1 : 0.85),
	};
}

/** Pink paper with the same speckle and faint grain as his shirt. */
function paper(ctx: CanvasRenderingContext2D, polygon: P[], id: number, count: number, shade: number): void {
	fill(ctx, polygon, RIBBON_FACE, 1);
	if (shade) fill(ctx, polygon, RIBBON_SHADE, shade);
	stipple(ctx, polygon, id, count, RIBBON_TEXTURE, 0.42);
	hatch(ctx, polygon, id + 1, { spacing: 38, angle: -0.78, alpha: 0.045, width: 0.68, color: RIBBON_TEXTURE });
}

/**
 * A stroke as a hand draws it: no line runs ruler straight, so each one bows
 * gently to one side, and its ends run on a touch past where they were aimed.
 */
function handStroke(points: P[], id: number, loose: number): P[] {
	const length = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
	const steps = Math.max(2, Math.round(length / 0.06));
	// Walk the stroke at even spacing.
	const even: P[] = [];
	let segment = 0;
	let segmentStart = 0;
	for (let i = 0; i <= steps; i++) {
		const target = (length * i) / steps;
		while (segment < points.length - 2) {
			const next = segmentStart + Math.hypot(points[segment + 1].x - points[segment].x, points[segment + 1].y - points[segment].y);
			if (next >= target) break;
			segmentStart = next;
			segment++;
		}
		const from = points[segment];
		const to = points[segment + 1];
		const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
		const t = Math.min(1, Math.max(0, (target - segmentStart) / span));
		even.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
	}
	const bow = (hash(id, 1, 31) - 0.5) * 2 * 0.045 * loose * Math.min(1, length);
	const sway = (hash(id, 2, 37) - 0.5) * 2 * 0.012 * loose;
	const run = 0.03 * loose;
	return even.map((point, i) => {
		const t = i / steps;
		const before = even[Math.max(0, i - 1)];
		const after = even[Math.min(even.length - 1, i + 1)];
		const dx = after.x - before.x;
		const dy = after.y - before.y;
		const d = Math.hypot(dx, dy) || 1;
		const push = bow * Math.sin(Math.PI * t) + sway * Math.sin(Math.PI * 2 * t);
		// Ends overshoot along the stroke's own direction.
		const overshoot = i === 0 ? -run * hash(id, 3, 41) : i === steps ? run * hash(id, 4, 43) : 0;
		return { x: point.x - (dy / d) * push + (dx / d) * overshoot, y: point.y + (dx / d) * push + (dy / d) * overshoot };
	});
}

function drawRibbon(ctx: CanvasRenderingContext2D, ink: string): void {
	const outline = { width: 3.45, boil: 0.46, color: ink };

	for (const side of [-1, 1] as const) {
		const s = ribbonSide(side);
		// Tail, tucked behind and a little lower, with a V cut in its free end.
		const edges = band(side * s.tailIn, side * s.tailOut, s.drop, side * s.tailIn, side * s.tailOut, 10);
		const tail = [...edges.slice(0, 11), onRibbon(side * (s.tailOut - s.notch), s.drop), ...edges.slice(11)];
		paper(ctx, tail, 7100 + side, 90, 0.16);
		stroke(ctx, tail, 7200 + side * 3, outline);

		// The fold, where the band turns under into the tail: its back, in shadow.
		const fold = [
			ribbonEdge(side * (s.end + s.endBottom), 1, 0),
			ribbonEdge(side * (s.end + s.endBottom + s.foldLean), 1, s.drop),
			ribbonEdge(side * s.tailIn, 1, s.drop),
			ribbonEdge(side * s.tailIn, 1, 0),
		];
		paper(ctx, fold, 7300 + side, 30, 0.34);
		stroke(ctx, fold.slice(0, 3), 7400 + side * 3, outline);
	}

	// The front of the band.
	const left = ribbonSide(-1);
	const right = ribbonSide(1);
	const front = band(
		-(left.end + left.endTop), right.end + right.endTop, 0,
		-(left.end + left.endBottom), right.end + right.endBottom,
	);
	paper(ctx, front, 7500, 300, 0);
	stroke(ctx, front, 7500, { ...outline, closed: true, seamlessClosed: true });

	// Lettered in his own pen, at the scale his face is drawn, by a steady
	// hand: one cap height on one baseline, evenly spaced. Only the pen's own
	// wobble and a hair of drift keep it from looking set in type.
	// The letters are inked on their own layer, then laid down at his ink's
	// strength, so strokes that cross don't darken into blots at the joins.
	const layer = document.createElement('canvas');
	layer.width = ctx.canvas.width;
	layer.height = ctx.canvas.height;
	const letterCtx = layer.getContext('2d');
	if (!letterCtx) throw new Error('No 2D canvas context');
	letterCtx.setTransform(ctx.getTransform());
	const height = RIBBON.half * 1.04;
	const gap = 0.2;
	const letters = [...TEXT.toUpperCase()].map((letter) => GLYPHS[letter]).filter(Boolean);
	const total = letters.reduce((sum, glyph) => sum + glyph.w, 0) + gap * (letters.length - 1);
	let cursor = -total / 2;
	const loose = LETTER_HAND;
	letters.forEach((glyph, index) => {
		const theta = ((cursor + glyph.w / 2) * height) / RIBBON.R;
		const at = onRibbon(theta, (hash(7700, index, 1) - 0.5) * height * (0.02 + 0.03 * loose));
		const size = height * (1 + (hash(7700, index, 2) - 0.5) * (0.03 + 0.05 * loose));
		letterCtx.save();
		letterCtx.translate(at.x, at.y);
		letterCtx.rotate(-theta + (hash(7700, index, 3) - 0.5) * (0.025 + 0.04 * loose));
		letterCtx.scale(FACE_SCALE, FACE_SCALE);
		glyph.strokes.forEach((points, strokeIndex) => {
			const id = 7600 + index * 17 + strokeIndex;
			const placed = handStroke(points, id, loose).map((point, pointIndex, all) => {
				const along = (pointIndex / Math.max(1, all.length - 1)) * 1.6;
				const drift = 0.025 + 0.03 * loose;
				return {
					x: ((point.x - glyph.w / 2 + (valueNoise(along, 0.5, id * 2 + 1) - 0.5) * drift) * size) / FACE_SCALE,
					y: ((point.y - 0.5 + (valueNoise(along, 0.5, id * 2 + 2) - 0.5) * drift) * size) / FACE_SCALE,
				};
			});
			stroke(letterCtx, placed, id, { width: 2.5, boil: 0.38, wobble: 0.35 + 0.15 * loose, color: ink, alpha: 1.25 });
		});
		letterCtx.restore();
		cursor += glyph.w + gap;
	});
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 0.8;
	ctx.drawImage(layer, 0, 0);
	ctx.restore();
}

/** The part of his bust space the picture shows: the circle, grown to take in the ribbon's tails. */
function pictureView(): { x: number; y: number; w: number; h: number } {
	// Room for the outlines' ink and wobble.
	const pad = 12;
	const leftEnd = ribbonSide(-1);
	const rightEnd = ribbonSide(1);
	const shapes = [
		...circlePoints(CIRCLE.r),
		...band(-leftEnd.end, rightEnd.end, 0),
		...band(-leftEnd.tailOut, -leftEnd.tailIn, leftEnd.drop),
		...band(rightEnd.tailIn, rightEnd.tailOut, rightEnd.drop),
	];
	const x = Math.min(...shapes.map((point) => point.x)) - pad;
	const y = Math.min(...shapes.map((point) => point.y)) - pad;
	const right = Math.max(...shapes.map((point) => point.x)) + pad;
	const bottom = Math.max(...shapes.map((point) => point.y)) + pad;
	return { x, y, w: right - x, h: bottom - y };
}

/** Draws frame `frame` of the loop onto `canvas`, `width` pixels wide, outside the circle and ribbon left transparent. */
export function drawFrame(canvas: HTMLCanvasElement, frame: number, width: number): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No 2D canvas context');
	// His lines boil forward for half the loop and back for the rest, so the
	// last drawing leads into the first like any other pair.
	beginInkFrame(frame <= FRAMES / 2 ? frame : FRAMES - frame);
	const pose = loopPose(frame / FPS);
	const ink = DEFAULT_BLONKY_PALETTE.outlineInk;

	const view = pictureView();
	const k = width / view.w;
	canvas.width = width;
	canvas.height = Math.round(view.h * k);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);

	// Blonky on the disc, clipped just inside its outline so the ink covers the edge.
	ctx.save();
	polygonPath(ctx, circlePoints(CIRCLE.r - 1.5));
	ctx.clip();
	ctx.fillStyle = DISC;
	ctx.fill();
	const foreground = drawUpperBody(ctx, pose, DEFAULT_BLONKY_PALETTE, true, true);
	drawHead(ctx, pose, ink);
	foreground?.();
	ctx.restore();

	stroke(ctx, circlePoints(CIRCLE.r), 9001, { closed: true, seamlessClosed: true, width: 4.1, boil: 0.46, color: ink });
	drawRibbon(ctx, ink);
}
