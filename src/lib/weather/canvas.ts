/**
 * A canvas filling a weather container, run a frame at a time while it can
 * be seen: not in a closed dialog, a page that hides its weather, or with
 * reduced motion. What's settled on something can be drawn on a layer of
 * its own, in that thing's place on the page (see `layer`).
 */

const MAX_PIXEL_RATIO = 2;
// How far a layer reaches past its element, CSS px, for what heaps up on
// its top or hangs off its sides.
const LAYER_MARGIN = 48;

export interface WeatherFrame {
	context: CanvasRenderingContext2D;
	width: number;
	height: number;
	/** Since the last frame, at most a tenth of a second. */
	seconds: number;
	/**
	 * Somewhere to draw in `element`'s place on the page rather than in front
	 * of everything: whatever's in front of it is in front of this too. It
	 * takes page coordinates, as `context` does, and is cleared each frame.
	 * `element` has to be positioned, and not scaled or rotated.
	 */
	layer: (element: HTMLElement) => CanvasRenderingContext2D;
}

export interface WeatherCanvasHooks {
	/** The canvas has a (new) size, in CSS px. */
	resize: (width: number, height: number) => void;
	/** Steps and draws a frame, already cleared. Returns false once there's nothing left to draw. */
	frame: (frame: WeatherFrame) => boolean;
}

export interface WeatherCanvas {
	/** Whether it's running: it can be seen. */
	running: () => boolean;
	/** Stops and removes it. */
	finish: () => void;
}

/** Rain or snow, falling. */
export interface WeatherEffect {
	/** Lets it pile up from now on, or not. Turned off, what's piled up falls away. */
	accumulate: (on: boolean) => void;
	/** Stops it falling. What's settled on things dries or melts off first. */
	stop: () => void;
}

/** Whether `element` can be seen: it has a size, and nothing hides it. */
export function inSight(element: Element): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return false;
	// Hidden by `visibility`, as a closed dialog is, it keeps its size.
	return element.checkVisibility?.({ visibilityProperty: true, checkVisibilityCSS: true }) ?? true;
}

/**
 * Calls `changed` whenever `element` may have come into or gone out of
 * sight, or changed size: it's resized (whatever hides it with `display`
 * leaves it no size), or something it's in changes its attributes (a dialog
 * opens or closes). Returns a function that stops watching.
 */
export function watchSight(element: Element, changed: () => void): () => void {
	const resizes = new ResizeObserver(changed);
	resizes.observe(element);
	const mutations = new MutationObserver(changed);
	for (let node = element.parentElement; node; node = node.parentElement) {
		mutations.observe(node, { attributes: true });
	}
	return () => {
		resizes.disconnect();
		mutations.disconnect();
	};
}

export function createWeatherCanvas(container: HTMLElement, hooks: WeatherCanvasHooks): WeatherCanvas | undefined {
	const canvas = document.createElement('canvas');
	canvas.className = 'weather-canvas';
	canvas.setAttribute('aria-hidden', 'true');
	const context = canvas.getContext('2d');
	if (!context) return;
	container.appendChild(canvas);

	let width = 0;
	let height = 0;
	let ratio = 1;
	let request = 0;
	let last = 0;
	const layers = new Map<HTMLElement, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; drawn: boolean }>();

	const layer = (element: HTMLElement): CanvasRenderingContext2D => {
		let found = layers.get(element);
		if (!found) {
			const layerCanvas = document.createElement('canvas');
			layerCanvas.className = 'weather-layer';
			layerCanvas.setAttribute('aria-hidden', 'true');
			layerCanvas.style.left = layerCanvas.style.top = `${-LAYER_MARGIN}px`;
			const layerContext = layerCanvas.getContext('2d');
			// Nowhere else to draw it: in front of everything, then.
			if (!layerContext) return context;
			element.appendChild(layerCanvas);
			found = { canvas: layerCanvas, context: layerContext, drawn: false };
			layers.set(element, found);
		}
		if (!found.drawn) {
			found.drawn = true;
			const rect = element.getBoundingClientRect();
			const layerWidth = Math.round((rect.width + LAYER_MARGIN * 2) * ratio);
			const layerHeight = Math.round((rect.height + LAYER_MARGIN * 2) * ratio);
			if (found.canvas.width !== layerWidth || found.canvas.height !== layerHeight) {
				found.canvas.width = layerWidth;
				found.canvas.height = layerHeight;
				found.canvas.style.width = `${layerWidth / ratio}px`;
				found.canvas.style.height = `${layerHeight / ratio}px`;
			}
			found.context.setTransform(1, 0, 0, 1, 0, 0);
			found.context.clearRect(0, 0, layerWidth, layerHeight);
			found.context.setTransform(ratio, 0, 0, ratio, (LAYER_MARGIN - rect.left) * ratio, (LAYER_MARGIN - rect.top) * ratio);
		}
		return found.context;
	};

	const removeLayers = (): void => {
		for (const { canvas: layerCanvas } of layers.values()) layerCanvas.remove();
		layers.clear();
	};

	const tick = (now: number): void => {
		request = 0;
		const seconds = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
		last = now;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		for (const found of layers.values()) found.drawn = false;
		const more = hooks.frame({ context, width, height, seconds, layer });
		// A layer nothing was drawn on this frame has nothing on it.
		for (const [element, found] of layers) {
			if (found.drawn) continue;
			found.canvas.remove();
			layers.delete(element);
		}
		if (!more) {
			finish();
			return;
		}
		request = requestAnimationFrame(tick);
	};

	const update = (): void => {
		if (!inSight(canvas)) {
			cancelAnimationFrame(request);
			request = 0;
			// Out of sight, what's on its layers goes with it.
			removeLayers();
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const nextRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, devicePixelRatio || 1));
		if (rect.width !== width || rect.height !== height || nextRatio !== ratio) {
			ratio = nextRatio;
			width = rect.width;
			height = rect.height;
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			hooks.resize(width, height);
		}
		if (!request) {
			last = 0;
			request = requestAnimationFrame(tick);
		}
	};
	const stopWatching = watchSight(canvas, update);

	const finish = (): void => {
		cancelAnimationFrame(request);
		request = 0;
		stopWatching();
		canvas.remove();
		removeLayers();
	};
	return { running: () => request !== 0, finish };
}
