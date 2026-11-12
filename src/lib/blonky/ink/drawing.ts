import { poseAtRest } from '../geometry';
import {
	BLONKY_FPS,
	BLONKY_VIEW_FRAMING,
	BLONKY_VIEWPORTS,
	type BlonkyDrawOptions,
} from '../types';
import { drawUpperBody } from './body';
import { drawHead } from './head';
import { DEFAULT_BLONKY_PALETTE } from './palette';
import { beginInkFrame } from './pen';

/** Blonky in ink: the hand-drawn figure, stroked onto a 2D canvas. */
export function drawBlonky(ctx: CanvasRenderingContext2D, time: number, options: BlonkyDrawOptions = {}): void {
	const frame = Math.floor(time * BLONKY_FPS);
	beginInkFrame(frame);
	const inkTime = frame / BLONKY_FPS;
	const view = options.view ?? 'bust';
	const viewport = BLONKY_VIEWPORTS[view];
	const palette = options.palette ?? DEFAULT_BLONKY_PALETTE;
	ctx.clearRect(0, 0, viewport.width, viewport.height);
	const pose = poseAtRest(inkTime, options.emote, options.gaze);
	const showBody = options.showBody !== false;
	const showArms = options.showArms ?? showBody;
	const framing = BLONKY_VIEW_FRAMING[view];
	ctx.save();
	ctx.translate(framing.x, framing.y);
	ctx.scale(framing.scale, framing.scale);
	const foreground = showArms || showBody ? drawUpperBody(ctx, pose, palette, showArms, showBody) : undefined;
	if (options.showHead !== false) drawHead(ctx, pose, palette.outlineInk);
	foreground?.();
	ctx.restore();
}
