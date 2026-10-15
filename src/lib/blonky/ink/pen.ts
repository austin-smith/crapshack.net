import {
	add,
	densify,
	mul,
	norm,
	normal,
	pointInPolygon,
	polygonBounds,
	sub,
	type Pt,
} from '../geometry/points';
import { smoothstep } from '../motion';
import { hash, valueNoise } from '../noise';
import { FACE_INK } from './palette';

export const TAU = Math.PI * 2;
// The drawing being inked: its lines boil from one drawing to the next.
let frame = 0;

export function beginInkFrame(next: number): void {
	frame = next;
}

export function inkFrame(): number {
	return frame;
}

export interface StrokeOptions {
	closed?: boolean;
	seamlessClosed?: boolean;
	width?: number;
	alpha?: number;
	passes?: number;
	boil?: number;
	wobble?: number;
	color?: string;
	fillRule?: CanvasFillRule;
	roundedClosedStroke?: boolean;
	roundedStroke?: boolean;
}

export function stroke(ctx: CanvasRenderingContext2D, anchors: Pt[], id: number, options: StrokeOptions = {}): void {
	if (anchors.length < 2) return;
	const closed = options.closed ?? false;
	const seamlessClosed = closed && (options.seamlessClosed ?? false);
	const width = options.width ?? 2.25;
	const passes = options.passes ?? 2;
	const points = densify(anchors, closed, 4.5);
	if (seamlessClosed) points.pop();
	const length = points.slice(1).reduce(
		(total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y),
		seamlessClosed
			? Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y)
			: 0,
	);
	const contourScale = Math.min(1, length / 180);
	ctx.save();
	ctx.fillStyle = options.color ?? FACE_INK;
	ctx.strokeStyle = options.color ?? FACE_INK;
	for (let pass = 0; pass < passes; pass++) {
		const primaryPass = pass === 0;
		ctx.globalAlpha = (options.alpha ?? 0.92) * (primaryPass ? 0.82 : 0.14);
		const moved = points.map((point, index) => {
			const before = seamlessClosed
				? points[(index - 1 + points.length) % points.length]
				: points[Math.max(0, index - 1)];
			const after = seamlessClosed
				? points[(index + 1) % points.length]
				: points[Math.min(points.length - 1, index + 1)];
			const n = normal(norm(sub(after, before)));
			const u = index * 0.34;
			const staticWobble = (valueNoise(u, pass * 7.3, id + 101) - 0.5) * 2.35;
			// Sample one slowly moving field across the contour so neighboring
			// points remain correlated instead of producing independent x/y jitter.
			const live = (0.9 + contourScale * 0.45) * (0.92 + (options.boil ?? 0.36) * 0.22);
			const boilingWobble =
				(valueNoise(u * 0.72, frame * 0.41 + pass * 9.1, id + 503) - 0.5) * live * 2
				+ (valueNoise(u * 1.45, frame * 0.73 + pass * 4.7, id + 557) - 0.5) * live * 0.65;
			const restatement = pass ? 0.3 : 0;
			const displacement = (staticWobble + boilingWobble + restatement) * (options.wobble ?? 1);
			return { x: point.x + n.x * displacement, y: point.y + n.y * displacement };
		});
		if ((closed && options.roundedClosedStroke) || options.roundedStroke) {
			ctx.beginPath();
			ctx.moveTo(moved[0].x, moved[0].y);
			for (let index = 1; index < moved.length; index++) {
				ctx.lineTo(moved[index].x, moved[index].y);
			}
			if (closed) ctx.closePath();
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.lineWidth = width * (primaryPass ? 0.86 : 0.33);
			ctx.stroke();
			continue;
		}
		const bandNormals = moved.map((_, index) => {
			const before = seamlessClosed
				? moved[(index - 1 + moved.length) % moved.length]
				: moved[Math.max(0, index - 1)];
			const after = seamlessClosed
				? moved[(index + 1) % moved.length]
				: moved[Math.min(moved.length - 1, index + 1)];
			return normal(norm(sub(after, before)));
		});
		const radii = moved.map((_, index) => {
			const progress = moved.length === 1 ? 0.5 : index / (moved.length - 1);
			const endpointPool = closed
				? 0
				: Math.max(
					1 - smoothstep(Math.min(1, progress / 0.075)),
					1 - smoothstep(Math.min(1, (1 - progress) / 0.075)),
				) * 0.11;
			const pressure = 0.96
				+ (valueNoise(index * 0.2, pass * 5.7, id + 709) - 0.5) * 0.24
				+ (valueNoise(index * 0.13, frame * 0.29 + pass * 3.1, id + 811) - 0.5) * 0.08
				+ endpointPool;
			return Math.max(0.18, width * (primaryPass ? 0.89 : 0.34) * pressure * 0.5);
		});
		const left = moved.map((point, index) => add(point, mul(bandNormals[index], radii[index])));
		const right = moved.map((point, index) => add(point, mul(bandNormals[index], -radii[index])));

		ctx.beginPath();
		ctx.moveTo(left[0].x, left[0].y);
		for (let index = 1; index < left.length; index++) ctx.lineTo(left[index].x, left[index].y);
		if (seamlessClosed) {
			ctx.closePath();
			ctx.moveTo(right.at(-1)!.x, right.at(-1)!.y);
			for (let index = right.length - 2; index >= 0; index--) ctx.lineTo(right[index].x, right[index].y);
			ctx.closePath();
		} else {
			for (let index = right.length - 1; index >= 0; index--) ctx.lineTo(right[index].x, right[index].y);
			ctx.closePath();
		}
		ctx.fill(options.fillRule ?? 'evenodd');
		if (!closed) {
			for (const index of [0, moved.length - 1]) {
				ctx.beginPath();
				ctx.arc(moved[index].x, moved[index].y, radii[index], 0, TAU);
				ctx.fill();
			}
		}
	}
	ctx.restore();
}

export function polygonPath(ctx: CanvasRenderingContext2D, polygon: Pt[]): void {
	ctx.beginPath();
	ctx.moveTo(polygon[0].x, polygon[0].y);
	for (let index = 1; index < polygon.length; index++) ctx.lineTo(polygon[index].x, polygon[index].y);
	ctx.closePath();
}

export function fill(ctx: CanvasRenderingContext2D, polygon: Pt[], color: string, alpha: number): void {
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = alpha;
	polygonPath(ctx, polygon);
	ctx.fill();
	ctx.restore();
}

export interface HatchOptions {
	spacing?: number;
	angle?: number;
	alpha?: number;
	width?: number;
	cross?: boolean;
	color?: string;
}

export function hatch(ctx: CanvasRenderingContext2D, polygon: Pt[], id: number, options: HatchOptions = {}): void {
	if (polygon.length < 3) return;
	const { minX, maxX, minY, maxY } = polygonBounds(polygon);
	const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
	const reach = Math.hypot(maxX - minX, maxY - minY) * 0.8 + 12;

	const pass = (angle: number, passId: number, alpha: number): void => {
		ctx.save();
		polygonPath(ctx, polygon);
		ctx.clip();
		ctx.translate(center.x, center.y);
		ctx.rotate(angle);
		let line = 0;
		let y = -reach;
		while (y <= reach) {
			if (hash(passId, line, 89) > 0.08) {
				const bend = (hash(passId, line, 97) - 0.5) * (options.spacing ?? 7) * 0.9;
				stroke(ctx, [
					{ x: -reach, y: y + (hash(passId, line, 101) - 0.5) * 3 },
					{ x: 0, y: y + bend },
					{ x: reach, y: y + (hash(passId, line, 103) - 0.5) * 3 },
				], passId + line * 13, {
					width: options.width ?? 1.05,
					alpha,
					passes: 1,
					boil: 0.25,
					color: options.color,
				});
			}
			y += (options.spacing ?? 7) * (0.72 + hash(passId, line, 107) * 0.58);
			line++;
		}
		ctx.restore();
	};

	pass(options.angle ?? -0.74, id, options.alpha ?? 0.7);
	if (options.cross) pass((options.angle ?? -0.74) * -0.78, id + 9001, (options.alpha ?? 0.7) * 0.58);
}

export function stipple(
	ctx: CanvasRenderingContext2D,
	polygon: Pt[],
	id: number,
	count: number,
	color: string,
	alpha = 0.6,
): void {
	const { minX, maxX, minY, maxY } = polygonBounds(polygon);
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = alpha;
	for (let index = 0; index < count; index++) {
		const point = {
			x: minX + hash(id, index, 211) * (maxX - minX),
			y: minY + hash(id, index, 223) * (maxY - minY),
		};
		if (!pointInPolygon(point, polygon)) continue;
		const densityField = valueNoise((point.x - minX) / 105, (point.y - minY) / 88, id + 1009);
		if (hash(id, index, 229) > 0.18 + densityField * 0.7) continue;
		const radius = 0.35 + hash(id, index, 227) * 0.85;
		ctx.beginPath();
		ctx.arc(point.x, point.y, radius, 0, TAU);
		ctx.fill();
	}
	ctx.restore();
}

export function clipOutside(ctx: CanvasRenderingContext2D, polygon: Pt[]): void {
	ctx.beginPath();
	ctx.rect(-2000, -2000, 5000, 5000);
	ctx.moveTo(polygon[0].x, polygon[0].y);
	for (const point of polygon.slice(1)) ctx.lineTo(point.x, point.y);
	ctx.closePath();
	ctx.clip('evenodd');
}
