import drawing from '../data/once-in-a-lifetime.json';
import { valueNoise } from './noise';

/**
 * The drawing, traced stroke for stroke by artwork/once-in-a-lifetime. He
 * just stands there; it is the line that moves. Every line is redrawn a
 * little differently several times a second, so nothing in it sits still.
 */

/** The part of the traced page shown, in the drawing's own pixels. */
export const VIEW = { x: -70, y: 10, width: 900, height: 2760 };

const FPS = 24;
// The lines are redrawn six times a second.
const REDRAW_FRAMES = 4;
/** How long the figure takes to draw itself. */
const INTRO_SECONDS = 2.8;

// How far a redrawn line strays, in drawing pixels: `bend` pushes whole
// stretches of line about, `shake` roughens it. `across` is how far apart, in
// drawing pixels, two points must be to be pushed different ways.
const BEND = { stray: 5, across: 120 };
const SHAKE = { stray: 2, across: 28 };

interface Stroke {
	ink: number;
	width: number;
	/** x, y pairs. */
	points: Float32Array;
	length: number;
	/** Seconds into the intro that the stroke starts being drawn, and how long it takes. */
	drawAt: number;
	drawFor: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function readStrokes(): Stroke[] {
	return drawing.strokes.map((row): Stroke => {
		// A row is its ink, its width in tenths of a pixel, then its points.
		const points = Float32Array.from(row.slice(2));
		let length = 0;
		let top = Infinity;
		for (let i = 0; i < points.length; i += 2) {
			top = Math.min(top, points[i + 1]);
			if (i) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
		}
		const down = (top - VIEW.y) / VIEW.height;
		return {
			ink: row[0],
			width: row[1] / 10,
			points,
			length,
			// Outline first, top to bottom; the colours scribble in just behind it.
			drawAt: drawing.inks[row[0]] === 'white' ? 0.1 + down * 1.5 : 0.7 + down * 1.6,
			drawFor: clamp(length / 900, 0.1, 0.45),
		};
	});
}

/** Each ink's colour, in the order the strokes number them. once-in-a-lifetime-palette.css declares the colours. */
function readInkColors(canvas: HTMLCanvasElement): string[] {
	const styles = getComputedStyle(canvas);
	return drawing.inks.map((ink) => styles.getPropertyValue(`--once-in-a-lifetime-${ink}`).trim());
}

interface OnceInALifetimePainter {
	/** Draws the figure `seconds` after it first appeared. */
	draw(seconds: number): void;
	/** Draws the figure exactly as it was drawn. */
	drawStill(): void;
}

function createOnceInALifetimePainter(ctx: CanvasRenderingContext2D): OnceInALifetimePainter {
	const inkColors = readInkColors(ctx.canvas);
	// One path per ink and line width, so a frame is a few dozen strokes of the pen.
	const batches = new Map<string, Stroke[]>();
	for (const stroke of readStrokes()) {
		const key = `${stroke.ink}:${Math.round(stroke.width * 2) / 2}`;
		const batch = batches.get(key);
		if (batch) batch.push(stroke);
		else batches.set(key, [stroke]);
	}

	function paint(seconds: number | undefined): void {
		const still = seconds === undefined;
		const frame = still ? 0 : Math.floor(seconds * FPS);
		const time = frame / FPS;
		const redraw = Math.floor(frame / REDRAW_FRAMES);
		ctx.clearRect(VIEW.x, VIEW.y, VIEW.width, VIEW.height);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		for (const [key, batch] of batches) {
			const [ink, width] = key.split(':').map(Number);
			// Each ink strays its own way each redraw, but every line of one ink through
			// a point strays together, so lines that meet stay joined.
			const seed = redraw * 4 + ink * 1000;
			ctx.beginPath();
			for (const stroke of batch) {
				const share = still ? 1 : clamp((time - stroke.drawAt) / stroke.drawFor);
				if (share <= 0) continue;
				const { points } = stroke;
				let left = stroke.length * share;
				let fromX = 0;
				let fromY = 0;
				for (let i = 0; i < points.length; i += 2) {
					let x = points[i];
					let y = points[i + 1];
					if (!still) {
						const bx = x / BEND.across;
						const by = y / BEND.across;
						const sx = x / SHAKE.across;
						const sy = y / SHAKE.across;
						x += (valueNoise(bx, by, seed) - 0.5) * 2 * BEND.stray + (valueNoise(sx, sy, seed + 1) - 0.5) * 2 * SHAKE.stray;
						y += (valueNoise(bx, by, seed + 2) - 0.5) * 2 * BEND.stray + (valueNoise(sx, sy, seed + 3) - 0.5) * 2 * SHAKE.stray;
					}
					if (i === 0) {
						ctx.moveTo(x, y);
					} else {
						const step = Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
						if (step > left) {
							const part = left / step;
							ctx.lineTo(fromX + (x - fromX) * part, fromY + (y - fromY) * part);
							break;
						}
						left -= step;
						ctx.lineTo(x, y);
					}
					fromX = x;
					fromY = y;
				}
			}
			ctx.strokeStyle = inkColors[ink];
			ctx.lineWidth = width;
			ctx.stroke();
		}
	}

	return { draw: paint, drawStill: () => paint(undefined) };
}

/** Sizes the canvas to its box and keeps the lines moving while the page is open. */
export function initOnceInALifetime(canvas: HTMLCanvasElement): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const painter = createOnceInALifetimePainter(ctx);
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const started = performance.now();
	let lastFrame = -1;

	const render = (now: number, force = false): void => {
		if (reducedMotion.matches) {
			if (force) painter.drawStill();
			return;
		}
		// Faded out or hidden, as he is on /experiments while another name is selected: nothing to redraw.
		if (!force && canvas.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return;
		const seconds = (now - started) / 1000;
		// Once he is drawn, only a redraw changes the picture.
		const frame = Math.floor(seconds * FPS);
		const shown = seconds < INTRO_SECONDS + 1 ? frame : Math.floor(frame / REDRAW_FRAMES);
		if (shown === lastFrame && !force) return;
		lastFrame = shown;
		painter.draw(seconds);
	};
	const fit = (): void => {
		const scale = (canvas.clientWidth * Math.min(2, devicePixelRatio || 1)) / VIEW.width;
		canvas.width = Math.round(VIEW.width * scale);
		canvas.height = Math.round(VIEW.height * scale);
		ctx.setTransform(scale, 0, 0, scale, -VIEW.x * scale, -VIEW.y * scale);
		render(performance.now(), true);
	};
	new ResizeObserver(fit).observe(canvas);
	reducedMotion.addEventListener('change', () => render(performance.now(), true));
	const tick = (): void => {
		render(performance.now());
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}
