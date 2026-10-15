export {
	createBlonkyAnimator,
	mountBlonkyCanvases,
	playBlonkyEmote,
	releaseBlonkyEmote,
	registerBlonkyCanvasLifecycle,
	setBlonkyPlaybackRate,
	setBlonkyRenderer,
	unmountBlonkyCanvases,
	type BlonkyAnimator,
} from './animator';
export { drawBlonky } from './ink/drawing';
export { DEFAULT_BLONKY_PALETTE } from './ink/palette';
export {
	BLONKY_EMOTES,
	isBlonkyEmote,
	sampleBlonkyEmoteOffset,
	type BlonkyEmote,
} from './emotes';
export {
	BLONKY_BUST_HEIGHT,
	BLONKY_BUST_WIDTH,
	BLONKY_EMOTE_TRANSITION_FRAMES,
	BLONKY_FPS,
	BLONKY_VIEWPORTS,
	type BlonkyDrawOptions,
	type BlonkyEmoteDefinition,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
	type BlonkyPalette,
	type BlonkyView,
} from './types';
