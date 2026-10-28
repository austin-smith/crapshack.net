import {
	addWeatherOccluder,
	addWeatherSurface,
	IDENTITY,
	multiply,
	polygonTop,
	rotation,
	scaling,
	translation,
	type Matrix,
	type WeatherSurface,
} from '../weather/surfaces';
import { BLONKY_FRAME_EVENT, type BlonkyFrame } from './animator';
import { bodyGeometry, headGeometry, poseAtRest, pointInPolygon, type Pt } from './geometry';
import { BLONKY_FPS, BLONKY_VIEW_FRAMING, BLONKY_VIEWPORTS } from './types';

/**
 * Blonky as somewhere for the weather to land: the top of his head, and his
 * shoulders. His head is one rigid shape, so what settles on it is kept in
 * the head's own coordinates and turns and bobs with it; his shoulders are
 * posed afresh each drawing, and what's on them rides along on top. Rain
 * soaks into his shirt. It's all drawn in his place on the page, so
 * whatever's in front of him, a menu or the page's own logo, is in front of
 * it too. He stands in front of what pools along the bottom.
 */

// How deep it gets on him, in CSS px.
const HEAD_DEPTH = 12;
const SHOULDER_DEPTH = 9;
// Columns across his head, in head units (about 2 bust units each), and
// across his shoulders, in bust units, from his middle.
const HEAD_COLUMNS = { from: -90, to: 92, dx: 1 };
const BODY_COLUMNS = { from: -470, to: 470, dx: 2.5 };
// Settle on his outline, not halfway through its ink.
const HEAD_INK = 1;
const BODY_INK = 1.3;
// Laid over his shirt where it's soaked, if his theme doesn't say
// (--blonky-shirt-wet): a deeper blue of it.
const WET_SHIRT = 'rgba(59, 87, 116, 0.62)';

export function addBlonkyWeatherSurfaces(root: HTMLElement): () => void {
	const skull = headGeometry(poseAtRest(0)).skull;
	const headColumns = Math.round((HEAD_COLUMNS.to - HEAD_COLUMNS.from) / HEAD_COLUMNS.dx) + 1;
	const headGround = new Float32Array(headColumns);
	for (let i = 0; i < headColumns; i++) {
		headGround[i] = polygonTop(skull, HEAD_COLUMNS.from + i * HEAD_COLUMNS.dx) - HEAD_INK;
	}
	const bodyColumns = Math.round((BODY_COLUMNS.to - BODY_COLUMNS.from) / BODY_COLUMNS.dx) + 1;

	const head: WeatherSurface = {
		x0: HEAD_COLUMNS.from,
		dx: HEAD_COLUMNS.dx,
		ground: headGround,
		pose: IDENTITY,
		view: IDENTITY,
		depth: HEAD_DEPTH,
		layer: root,
		drawing: 0,
		pace: BLONKY_FPS,
		version: 0,
	};
	const body: WeatherSurface = {
		x0: BODY_COLUMNS.from,
		dx: BODY_COLUMNS.dx,
		ground: new Float32Array(bodyColumns).fill(Number.NaN),
		pose: IDENTITY,
		view: IDENTITY,
		depth: SHOULDER_DEPTH,
		layer: root,
		drawing: 0,
		pace: BLONKY_FPS,
		version: 0,
	};

	// A deeper shade of whichever shirt his theme gives him.
	const wetShirt = (): string => getComputedStyle(root).getPropertyValue('--blonky-shirt-wet').trim() || WET_SHIRT;
	let wet = wetShirt();
	const themeObserver = new MutationObserver(() => {
		wet = wetShirt();
	});
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

	const canvas = (): HTMLCanvasElement | null => root.querySelector<HTMLCanvasElement>('[data-blonky-canvas]');
	const occluder = addWeatherOccluder(canvas);
	let removeHead: (() => void) | undefined;
	let removeBody: (() => void) | undefined;
	const update = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const { time, emote, gaze, rate, view } = event.detail as BlonkyFrame & { time: number };
		occluder.drawn();
		const rect = canvas()?.getBoundingClientRect();
		if (!rect || rect.width === 0) return;

		// Bust units onto the page, through the view's framing.
		const viewport = BLONKY_VIEWPORTS[view];
		const framing = BLONKY_VIEW_FRAMING[view];
		const onPage: Matrix = multiply(
			{ a: rect.width / viewport.width, b: 0, c: 0, d: rect.height / viewport.height, e: rect.left, f: rect.top },
			multiply(translation(framing.x, framing.y), scaling(framing.scale)),
		);

		// Posed as the ink drawing poses him, on the same frame.
		const drawing = Math.floor(time * BLONKY_FPS);
		const pose = poseAtRest(drawing / BLONKY_FPS, emote, gaze);
		const headShape = headGeometry(pose);
		head.pose = multiply(
			multiply(translation(headShape.pivot.x, headShape.pivot.y), rotation(headShape.angle)),
			multiply(translation(headShape.offset.x, headShape.offset.y), scaling(headShape.scale.x, headShape.scale.y)),
		);
		head.view = onPage;
		head.drawing = drawing;
		head.pace = BLONKY_FPS * rate;
		head.version++;

		// His shoulders' top: the shirt, its sleeves, and the skin at his
		// collar, except where his head is in front of them.
		const shape = bodyGeometry(pose);
		const parts = [shape.torso.surface, shape.leftArm.sleeveSurface, shape.rightArm.sleeveSurface, shape.collar.chestSkin];
		const headOutline: Pt[] = skull.map((point) => ({
			x: head.pose.a * point.x + head.pose.c * point.y + head.pose.e,
			y: head.pose.b * point.x + head.pose.d * point.y + head.pose.f,
		}));
		for (let i = 0; i < bodyColumns; i++) {
			const x = pose.centerX + BODY_COLUMNS.from + i * BODY_COLUMNS.dx;
			let top = Number.NaN;
			for (const part of parts) {
				const y = polygonTop(part, x);
				if (y < top || Number.isNaN(top)) top = y;
			}
			body.ground[i] = Number.isNaN(top) || pointInPolygon({ x, y: top }, headOutline) ? Number.NaN : top - BODY_INK;
		}
		// The rain soaks his shirt, on the page.
		body.soaks = {
			parts: [shape.torso.surface, shape.leftArm.sleeveSurface, shape.rightArm.sleeveSurface].map((part) =>
				part.map((point) => ({ x: onPage.a * point.x + onPage.c * point.y + onPage.e, y: onPage.b * point.x + onPage.d * point.y + onPage.f })),
			),
			color: wet,
		};
		body.pose = translation(pose.centerX, 0);
		body.view = onPage;
		body.drawing = drawing;
		body.pace = BLONKY_FPS * rate;
		body.version++;

		// Somewhere to land only once he's been drawn, and so placed.
		removeHead ??= addWeatherSurface(head);
		removeBody ??= addWeatherSurface(body);
	};

	root.addEventListener(BLONKY_FRAME_EVENT, update);
	return () => {
		root.removeEventListener(BLONKY_FRAME_EVENT, update);
		themeObserver.disconnect();
		occluder.remove();
		removeHead?.();
		removeBody?.();
	};
}
