import {
	BLONKY_BUST_WIDTH,
	BLONKY_VIEW_FRAMING,
	BLONKY_VIEWPORTS,
	type BlonkyGaze,
	type BlonkyView,
} from './types';

// Between his eyes, at rest, in bust units.
const EYES = { x: 445, y: 195 };
// How far in front of the screen the visitor sits, in widths of his bust. The
// nearer they are, the further he turns to look at the same point.
const VIEWER_DISTANCE = 0.6;
// Once what he's watching has been still this long, he looks back at the
// visitor.
const ATTENTION_SPAN_MS = 4000;
// He lets smaller moves go, and glances only when his look would change by
// more than this.
const GLANCE_THRESHOLD = 0.1;
// Each drawing, his look covers this much of the way still to go.
const GLANCE_EASE = 0.5;
const SETTLED = 0.01;

const AT_VIEWER: Readonly<BlonkyGaze> = { x: 0, y: 0 };

/** The last thing on the page to catch his eye, in client pixels. */
let attention: { x: number; y: number; at: number } | undefined;
let watching = false;

const attend = (x: number, y: number): void => {
	attention = { x, y, at: performance.now() };
};

/**
 * Watches for what would catch his eye: the pointer, wherever it moves or
 * presses, and whatever the keyboard focuses. It's one watch for the whole
 * page, so he keeps track of it when a renderer swap remounts him.
 */
function watchAttention(): void {
	if (watching) return;
	watching = true;
	const options = { capture: true, passive: true };
	window.addEventListener('pointermove', (event) => attend(event.clientX, event.clientY), options);
	window.addEventListener('pointerdown', (event) => attend(event.clientX, event.clientY), options);
	// A mouse leaving the page takes his attention with it. A finger leaves
	// every time it lifts, so he keeps looking where it touched.
	document.documentElement.addEventListener('pointerleave', (event) => {
		if (event.pointerType === 'mouse') attention = undefined;
	}, options);
	window.addEventListener('focusin', (event) => {
		const target = event.target;
		if (!(target instanceof Element) || !target.matches(':focus-visible')) return;
		// Focused himself, he looks back out at the visitor.
		if (target.querySelector('[data-blonky-canvas]')) {
			attention = undefined;
			return;
		}
		const bounds = target.getBoundingClientRect();
		attend(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
	}, options);
}

export interface BlonkyGazeTracker {
	/** Where he's looking now. */
	current: () => BlonkyGaze;
	/** Moves his look on by one drawing, toward whatever has his attention. */
	step: () => void;
	/** Turns his attention back to the visitor, until something else catches his eye. */
	lookAtVisitor: () => void;
}

/** Follows what catches the eye of the Blonky drawn on `canvas`. */
export function createBlonkyGaze(canvas: HTMLCanvasElement, view: BlonkyView): BlonkyGazeTracker {
	watchAttention();
	const framing = BLONKY_VIEW_FRAMING[view];
	const viewport = BLONKY_VIEWPORTS[view];

	/** The look that would meet his attention, seen from his eyes on screen. */
	const lookToward = (): BlonkyGaze => {
		if (!attention || performance.now() - attention.at > ATTENTION_SPAN_MS) return AT_VIEWER;
		const bounds = canvas.getBoundingClientRect();
		if (bounds.width === 0) return AT_VIEWER;
		const unit = bounds.width / viewport.width;
		const dx = attention.x - (bounds.left + (framing.x + EYES.x * framing.scale) * unit);
		const dy = attention.y - (bounds.top + (framing.y + EYES.y * framing.scale) * unit);
		const depth = BLONKY_BUST_WIDTH * framing.scale * unit * VIEWER_DISTANCE;
		const distance = Math.hypot(dx, dy, depth);
		return { x: dx / distance, y: dy / distance };
	};

	let aim = lookToward();
	let look = aim;
	return {
		current: () => look,
		step: () => {
			const next = lookToward();
			if (Math.hypot(next.x - aim.x, next.y - aim.y) > GLANCE_THRESHOLD) aim = next;
			const eased = {
				x: look.x + (aim.x - look.x) * GLANCE_EASE,
				y: look.y + (aim.y - look.y) * GLANCE_EASE,
			};
			look = Math.hypot(aim.x - eased.x, aim.y - eased.y) < SETTLED ? aim : eased;
		},
		lookAtVisitor: () => {
			attention = undefined;
		},
	};
}
