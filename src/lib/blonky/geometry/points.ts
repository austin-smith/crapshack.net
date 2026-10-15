/** Points, and the curves and polygons drawn through them, in bust units. */

export type Pt = { x: number; y: number };

export function add(a: Pt, b: Pt): Pt {
	return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Pt, b: Pt): Pt {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(point: Pt, amount: number): Pt {
	return { x: point.x * amount, y: point.y * amount };
}

export function norm(point: Pt): Pt {
	const length = Math.hypot(point.x, point.y) || 1;
	return { x: point.x / length, y: point.y / length };
}

export function normal(point: Pt): Pt {
	return { x: -point.y, y: point.x };
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function segmentIntersection(aStart: Pt, aEnd: Pt, bStart: Pt, bEnd: Pt): Pt | undefined {
	const a = sub(aEnd, aStart);
	const b = sub(bEnd, bStart);
	const denominator = a.x * b.y - a.y * b.x;
	if (Math.abs(denominator) < 0.0001) return undefined;

	const offset = sub(bStart, aStart);
	const aProgress = (offset.x * b.y - offset.y * b.x) / denominator;
	const bProgress = (offset.x * a.y - offset.y * a.x) / denominator;
	if (aProgress < 0 || aProgress > 1 || bProgress < 0 || bProgress > 1) return undefined;
	return add(aStart, mul(a, aProgress));
}

export function endPolylineAtSegment(points: Pt[], segmentStart: Pt, segmentEnd: Pt): Pt[] {
	for (let index = points.length - 2; index >= 0; index--) {
		const intersection = segmentIntersection(points[index], points[index + 1], segmentStart, segmentEnd);
		if (intersection) return points.slice(0, index + 1).concat(intersection);
	}
	return points;
}

export function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x) inside = !inside;
	}
	return inside;
}

export interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export function polygonBounds(polygon: Pt[]): Bounds {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const point of polygon) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	return { minX, maxX, minY, maxY };
}

export function densify(points: Pt[], closed: boolean, step = 5): Pt[] {
	const source = closed ? points.concat(points[0]) : points;
	const result: Pt[] = [];
	for (let index = 0; index < source.length - 1; index++) {
		const a = source[index];
		const b = source[index + 1];
		const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
		for (let part = 0; part < count; part++) result.push(lerp(a, b, part / count));
	}
	result.push(source[source.length - 1]);
	return result;
}

export function quadratic(a: Pt, control: Pt, b: Pt, count = 18): Pt[] {
	return Array.from({ length: count + 1 }, (_, index) => {
		const t = index / count;
		const u = 1 - t;
		return {
			x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
			y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
		};
	});
}

/**
 * Samples a limb through its joint. Each straight part gets a fixed number of
 * segments, so a limb whose length breathes keeps the same samples from one
 * drawing to the next.
 */
export function throughJoint(chain: [Pt, Pt, Pt], segments: [number, number]): Pt[] {
	const [start, joint, end] = chain;
	const intoJoint = lerp(start, joint, 0.72);
	const outOfJoint = lerp(joint, end, 0.28);
	const divide = (a: Pt, b: Pt, count: number): Pt[] => [
		...Array.from({ length: count }, (_, index) => lerp(a, b, index / count)),
		b,
	];
	return divide(start, intoJoint, segments[0])
		.slice(0, -1)
		.concat(quadratic(intoJoint, joint, outOfJoint, 8))
		.concat(divide(outOfJoint, end, segments[1]).slice(1));
}

export function rotateAbout(point: Pt, pivot: Pt, angle: number): Pt {
	const relative = sub(point, pivot);
	return add(pivot, {
		x: relative.x * Math.cos(angle) - relative.y * Math.sin(angle),
		y: relative.x * Math.sin(angle) + relative.y * Math.cos(angle),
	});
}
