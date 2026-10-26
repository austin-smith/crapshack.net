/**
 * A canvas filling a weather container, run a frame at a time while it can
 * be seen: not in a closed dialog, a page that hides its weather, or with
 * reduced motion.
 */

const MAX_PIXEL_RATIO = 2;

export interface WeatherFrame {
	context: CanvasRenderingContext2D;
	width: number;
	height: number;
	/** Since the last frame, at most a tenth of a second. */
	seconds: number;
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

	const tick = (now: number): void => {
		request = 0;
		const seconds = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
		last = now;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		if (!hooks.frame({ context, width, height, seconds })) {
			finish();
			return;
		}
		request = requestAnimationFrame(tick);
	};

	const update = (): void => {
		if (!inSight(canvas)) {
			cancelAnimationFrame(request);
			request = 0;
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
	};
	return { running: () => request !== 0, finish };
}
