import { poseAtRest } from '../geometry';
import {
	BLONKY_BUST_WIDTH,
	BLONKY_FPS,
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
	const pose = poseAtRest(inkTime, options.emote);
	const showBody = options.showBody !== false;
	const showArms = options.showArms ?? showBody;
	ctx.save();
	if (view === 'debug') {
		ctx.translate((viewport.width - BLONKY_BUST_WIDTH) / 2, 0);
	} else if (view === 'portrait') {
		ctx.translate(8, -5);
		ctx.scale(0.56, 0.56);
	}
	const foreground = showArms || showBody ? drawUpperBody(ctx, pose, palette, showArms, showBody) : undefined;
	if (options.showHead !== false) drawHead(ctx, pose, palette.outlineInk);
	foreground?.();
	ctx.restore();
}
