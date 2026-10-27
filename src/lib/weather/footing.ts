import { invert, multiply, weatherSurfaces, type Matrix, type WeatherSurface } from './surfaces';

/**
 * The weather's hold on each surface it can land on (see ./surfaces): where
 * the surface is on the page this frame, and how sharply each column of it
 * jolted at its last move, for what's settled there to be thrown off. Snow
 * and rain each keep their own `data` on it: a drift, or beads of water.
 */

export interface Footing<T> {
	surface: WeatherSurface;
	version: number;
	/** The surface's drawing when last seen. */
	drawing: number;
	/** The surface's own coordinates onto the page, and back. */
	toPage: Matrix;
	fromPage: Matrix;
	/** CSS px per local unit, across and down. */
	unitX: number;
	unitY: number;
	/** Each column's ground in the space the surface moves in, as x, y pairs. */
	place: Float32Array;
	/** Each column's ground on the page, as x, y pairs: where it last was, where it's gone. */
	page: Float32Array;
	/** How each column moved, then how sharply that changed at its last move: x, y pairs, CSS px. */
	motion: Float32Array;
	jolt: Float32Array;
	data: T;
}

export interface FootingHooks<T> {
	create: (surface: WeatherSurface) => T;
	/**
	 * The surface moved or changed; `jolt` is fresh. `columns` is how many
	 * columns it had before, if that changed.
	 */
	changed: (footing: Footing<T>, columns?: number) => void;
	/** The surface has gone from the page. */
	removed: (footing: Footing<T>) => void;
}

export function createFootings<T>(hooks: FootingHooks<T>) {
	const footings = new Map<WeatherSurface, Footing<T>>();

	const update = (footing: Footing<T>): void => {
		const { surface } = footing;
		const columns = surface.ground.length;
		const before = footing.place.length / 2;
		const resized = before !== columns;
		if (resized) {
			footing.place = new Float32Array(columns * 2).fill(Number.NaN);
			footing.page = new Float32Array(columns * 2).fill(Number.NaN);
			footing.motion = new Float32Array(columns * 2);
			footing.jolt = new Float32Array(columns * 2);
		}
		footing.version = surface.version;
		// On to the next drawing, it moved; the same drawing again, it only
		// settled into place. Any other way, it's moved more than one drawing
		// since it was last seen: it starts again from still.
		const step = surface.drawing - footing.drawing;
		footing.drawing = surface.drawing;
		footing.toPage = multiply(surface.view, surface.pose);
		footing.fromPage = invert(footing.toPage);
		footing.unitX = Math.hypot(footing.toPage.a, footing.toPage.b);
		footing.unitY = Math.hypot(footing.toPage.c, footing.toPage.d);
		const { pose, view, ground, x0, dx } = surface;
		const viewScale = Math.sqrt(Math.abs(view.a * view.d - view.b * view.c));
		const { place, page, motion, jolt } = footing;
		for (let i = 0; i < columns; i++) {
			const x = x0 + i * dx;
			const y = ground[i];
			const lastX = place[i * 2];
			const lastY = place[i * 2 + 1];
			jolt[i * 2] = 0;
			jolt[i * 2 + 1] = 0;
			if (Number.isNaN(y)) {
				place[i * 2] = Number.NaN;
				continue;
			}
			const px = pose.a * x + pose.c * y + pose.e;
			const py = pose.b * x + pose.d * y + pose.f;
			place[i * 2] = px;
			place[i * 2 + 1] = py;
			page[i * 2] = view.a * px + view.c * py + view.e;
			page[i * 2 + 1] = view.b * px + view.d * py + view.f;
			if (step === 0) continue;
			if (step !== 1 || Number.isNaN(lastX)) {
				motion[i * 2] = 0;
				motion[i * 2 + 1] = 0;
				continue;
			}
			const moveX = (px - lastX) * viewScale;
			const moveY = (py - lastY) * viewScale;
			jolt[i * 2] = moveX - motion[i * 2];
			jolt[i * 2 + 1] = moveY - motion[i * 2 + 1];
			motion[i * 2] = moveX;
			motion[i * 2 + 1] = moveY;
		}
		hooks.changed(footing, resized ? before : undefined);
	};

	return {
		/** Brings every footing up to date with its surface, and lets go of surfaces that have gone. */
		sync: (): void => {
			const present = weatherSurfaces();
			for (const surface of present) {
				let footing = footings.get(surface);
				if (!footing) {
					footing = {
						surface,
						version: -1,
						drawing: Number.NaN,
						toPage: surface.view,
						fromPage: surface.view,
						unitX: 1,
						unitY: 1,
						place: new Float32Array(0),
						page: new Float32Array(0),
						motion: new Float32Array(0),
						jolt: new Float32Array(0),
						data: hooks.create(surface),
					};
					footings.set(surface, footing);
				}
				if (footing.version !== surface.version) update(footing);
			}
			for (const [surface, footing] of footings) {
				if (present.has(surface)) continue;
				hooks.removed(footing);
				footings.delete(surface);
			}
		},
		/** Lets go of every surface, as if each had gone from the page. */
		clear: (): void => {
			for (const footing of footings.values()) hooks.removed(footing);
			footings.clear();
		},
		values: (): IterableIterator<Footing<T>> => footings.values(),
		get size(): number {
			return footings.size;
		},
	};
}

/**
 * A surface's ground at `column` (fractional, between columns), lifted
 * `lift` local units, on the page. NaN where there's no ground.
 */
export function pagePoint<T>(footing: Footing<T>, column: number, lift = 0): { x: number; y: number } {
	const { ground, x0, dx } = footing.surface;
	const below = Math.max(0, Math.min(ground.length - 1, Math.floor(column)));
	const above = Math.min(ground.length - 1, below + 1);
	const t = Math.max(0, Math.min(1, column - below));
	const a = ground[below];
	const b = ground[above];
	const y = (Number.isNaN(a) ? b : Number.isNaN(b) ? a : a + (b - a) * t) - lift;
	const x = x0 + column * dx;
	const m = footing.toPage;
	return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * A whole column's ground on the page, lifted `lift` local units: its x,
 * then its y. For columns with ground, without pagePoint's going between
 * columns.
 */
export function columnX<T>(footing: Footing<T>, column: number, lift = 0): number {
	const { ground, x0, dx } = footing.surface;
	const m = footing.toPage;
	return m.a * (x0 + column * dx) + m.c * (ground[column] - lift) + m.e;
}

export function columnY<T>(footing: Footing<T>, column: number, lift = 0): number {
	const { ground, x0, dx } = footing.surface;
	const m = footing.toPage;
	return m.b * (x0 + column * dx) + m.d * (ground[column] - lift) + m.f;
}

/**
 * Where a column's ground was on the page when it was last there: for what
 * was on it when it went. NaN if it's never had any.
 */
export function lastPagePoint<T>(footing: Footing<T>, column: number): { x: number; y: number } {
	const index = Math.max(0, Math.min(footing.surface.ground.length - 1, Math.round(column)));
	return { x: footing.page[index * 2], y: footing.page[index * 2 + 1] };
}

/** Which column of a surface page point (x, y) is over, fractionally. */
export function columnAt<T>(footing: Footing<T>, x: number, y: number): number {
	const m = footing.fromPage;
	const { x0, dx } = footing.surface;
	return (m.a * x + m.c * y + m.e - x0) / dx;
}

/** Whether there's ground at the whole column nearest `column`. */
export function hasGround<T>(footing: Footing<T>, column: number): boolean {
	const index = Math.round(column);
	const { ground } = footing.surface;
	return index >= 0 && index < ground.length && !Number.isNaN(ground[index]);
}

/**
 * Whether something on the page is in front of a surface at page point
 * (x, y), a dialog or a menu: what falls in front of that can't reach the
 * surface there, nor can anything coming off the surface there be seen.
 * Only a surface with a `layer` can tell; what's in front of it is
 * whatever's topmost there that isn't in that element.
 */
export function coveredAt<T>(footing: Footing<T>, x: number, y: number): boolean {
	const element = footing.surface.layer;
	if (!element) return false;
	const top = document.elementFromPoint(x, y);
	return top !== null && !element.contains(top);
}

/**
 * The surface a particle falling from (x, lastY) to (x, y) reaches this
 * frame, if any: it crossed the top, or is only just under it (the surface
 * rose to meet it), where nothing's in front of it. `top` is the top's page
 * y at a column, if it differs from the ground's.
 */
export function landingOn<T>(
	footings: Iterable<Footing<T>>,
	x: number,
	y: number,
	lastY: number,
	top: (footing: Footing<T>, column: number) => number = (footing, column) => pagePoint(footing, column).y,
): Footing<T> | undefined {
	let found: Footing<T> | undefined;
	let foundTop = Number.POSITIVE_INFINITY;
	for (const footing of footings) {
		const column = Math.round(columnAt(footing, x, y));
		if (!hasGround(footing, column)) continue;
		const at = top(footing, column);
		if (y < at || (lastY >= at && y - at > 3)) continue;
		if (at < foundTop && !coveredAt(footing, x, at)) {
			found = footing;
			foundTop = at;
		}
	}
	return found;
}
