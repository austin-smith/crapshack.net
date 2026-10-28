/**
 * What the weather can land on: the tops of things on the page, each a row
 * of columns in its own coordinates, placed on the page by a matrix. A
 * surface that moves (Blonky) updates its ground and matrices as it goes;
 * the weather follows, and what's settled on it rides along.
 */

/** An affine map, as in DOMMatrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export interface WeatherSurface {
	/** The first column's x, and the spacing between columns, in the surface's own units. */
	x0: number;
	dx: number;
	/** The top of the surface at each column, in its own y (down); NaN where there's nothing. */
	ground: Float32Array;
	/** The surface's own coordinates into the space it moves in. */
	pose: Matrix;
	/** That space onto the viewport, in CSS px. */
	view: Matrix;
	/** The deepest anything settles here, in CSS px. */
	depth: number;
	/**
	 * Where what's settled here is drawn: in this element's place on the
	 * page, so whatever's in front of the surface is in front of that too
	 * (see `layer` in ./canvas). Without one, it's drawn in front of
	 * everything, with what's falling.
	 */
	layer?: HTMLElement;
	/**
	 * What of it soaks up rain, and the color that's laid over it soaked: as
	 * outlines on the page. Rain soaks down into it from its top, deeper the
	 * more lands, and it dries once the rain stops (see ./rain).
	 */
	soaks?: { parts: { x: number; y: number }[][]; color: string };
	/**
	 * Which drawing it's posed as, for a surface that moves on in drawings,
	 * `pace` a second, as Blonky does. What's settled on it feels each move
	 * from one drawing to the next: not the same drawing again, nor a move
	 * across drawings that went unseen.
	 */
	drawing: number;
	pace: number;
	/** Bumped whenever anything above changes. */
	version: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Matrix, n: Matrix): Matrix {
	return {
		a: m.a * n.a + m.c * n.b,
		b: m.b * n.a + m.d * n.b,
		c: m.a * n.c + m.c * n.d,
		d: m.b * n.c + m.d * n.d,
		e: m.a * n.e + m.c * n.f + m.e,
		f: m.b * n.e + m.d * n.f + m.f,
	};
}

export function translation(x: number, y: number): Matrix {
	return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaling(x: number, y = x): Matrix {
	return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotation(angle: number): Matrix {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function invert(m: Matrix): Matrix {
	const det = m.a * m.d - m.b * m.c || 1e-9;
	return {
		a: m.d / det,
		b: -m.b / det,
		c: -m.c / det,
		d: m.a / det,
		e: (m.c * m.f - m.d * m.e) / det,
		f: (m.b * m.e - m.a * m.f) / det,
	};
}

/** Where the top of a polygon is at `x`, or NaN if it doesn't reach there. */
export function polygonTop(points: readonly { x: number; y: number }[], x: number): number {
	let top = Number.NaN;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const p = points[i];
		const q = points[j];
		if ((p.x > x) === (q.x > x)) continue;
		const y = p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y);
		if (!(y >= top)) top = y;
	}
	return top;
}

const surfaces = new Set<WeatherSurface>();
const occluders = new Set<() => HTMLCanvasElement | null>();
const occluderWatchers = new Set<() => void>();

const occludersChanged = (): void => {
	for (const watcher of occluderWatchers) watcher();
};

/** Lets the weather land on `surface`, until the returned function is called. */
export function addWeatherSurface(surface: WeatherSurface): () => void {
	surfaces.add(surface);
	return () => {
		surfaces.delete(surface);
	};
}

export function weatherSurfaces(): ReadonlySet<WeatherSurface> {
	return surfaces;
}

/**
 * Puts what's drawn on a canvas in front of what pools along the bottom
 * (see ./pool): the pool is hidden wherever the canvas isn't clear. Pass the
 * canvas as a function, for one that's replaced as it goes. Call `drawn`
 * whenever it's drawn again, and `remove` once it's gone.
 */
export function addWeatherOccluder(canvas: () => HTMLCanvasElement | null): { drawn: () => void; remove: () => void } {
	occluders.add(canvas);
	occludersChanged();
	return {
		drawn: occludersChanged,
		remove: () => {
			occluders.delete(canvas);
			occludersChanged();
		},
	};
}

export function weatherOccluders(): ReadonlySet<() => HTMLCanvasElement | null> {
	return occluders;
}

/** Calls `watcher` whenever an occluder comes, goes, or is drawn again, until the returned function is called. */
export function watchWeatherOccluders(watcher: () => void): () => void {
	occluderWatchers.add(watcher);
	return () => {
		occluderWatchers.delete(watcher);
	};
}
