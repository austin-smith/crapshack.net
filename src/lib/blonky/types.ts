import type { BlonkyEmote } from './emotes';

export const BLONKY_BUST_WIDTH = 900;
export const BLONKY_BUST_HEIGHT = 800;
export const BLONKY_FPS = 8;
export const BLONKY_EMOTE_TRANSITION_FRAMES = 2;

// His forearms bow out past his sleeves, so his ink reaches about 21 units
// beyond either side of the bust. The debug and portrait views leave room
// for it, so neither crops his arms.
export const BLONKY_VIEWPORTS = {
	bust: { width: BLONKY_BUST_WIDTH, height: BLONKY_BUST_HEIGHT },
	debug: { width: 980, height: BLONKY_BUST_HEIGHT },
	portrait: { width: 544, height: 520 },
} as const;

export type BlonkyView = keyof typeof BLONKY_VIEWPORTS;

/** Where the bust sits in each view: its offset, in view units, and its scale. */
export const BLONKY_VIEW_FRAMING: Readonly<Record<BlonkyView, { x: number; y: number; scale: number }>> = {
	bust: { x: 0, y: 0, scale: 1 },
	debug: { x: (BLONKY_VIEWPORTS.debug.width - BLONKY_BUST_WIDTH) / 2, y: 0, scale: 1 },
	portrait: { x: 20, y: -5, scale: 0.56 },
};

/**
 * How a painter shades its figure, for inspecting it: fully lit, or one
 * part of the picture on its own.
 */
export const BLONKY_SHADINGS = {
	lit: 'lit',
	even: 'even light',
	clay: 'grey clay',
	paint: 'paint',
	depth: 'depth',
	normals: 'normals',
	shadows: 'shadows',
} as const;

export type BlonkyShading = keyof typeof BLONKY_SHADINGS;

export function isBlonkyShading(value: unknown): value is BlonkyShading {
	return typeof value === 'string' && Object.hasOwn(BLONKY_SHADINGS, value);
}

/**
 * Everything about one emote. Its module exports this, and the emote is
 * playable once it's listed in BLONKY_EMOTES.
 */
export interface BlonkyEmoteDefinition {
	label: string;
	duration: number;
	/** Holds its last pose until released, instead of returning to rest. */
	holds?: boolean;
	/** Representative drawing for reduced-motion playback. */
	stillFrame?: number;
	/** Offered in Blonky's menu with this icon. Without one, only the lab and the page play it. */
	menuIcon?: string;
	sample: (elapsed: number, direction: -1 | 1, heldElapsed?: number) => BlonkyEmoteSample;
	/**
	 * Played instead of the emote when it interrupts another, in place of the
	 * usual two-drawing blend from the interrupted pose.
	 */
	interrupting?: (from: BlonkyEmoteOffset, elapsed: number) => BlonkyEmoteSample;
}

/** How far each part of Blonky is from rest, at one moment of an emote. */
export interface BlonkyEmoteOffset {
	presence: number;
	armTension: number;
	leftWave: number;
	rightWave: number;
	leftWaveSwing: number;
	rightWaveSwing: number;
	/** Finger spread: 0 is loosely gathered, 1 is an open greeting. */
	leftWaveFingers: number;
	rightWaveFingers: number;
	headX: number;
	headY: number;
	headAngle: number;
	headTurn: number;
	faceLookY: number;
	eyeLookY: number;
	bodyX: number;
	shoulderY: number;
	torsoY: number;
	shoulderTilt: number;
	bellySpread: number;
	mouthPurse: number;
	mouthTension: number;
	mouthFrown: number;
	mouthSmile: number;
	leftBrowLift: number;
	rightBrowLift: number;
	leftBrowArch: number;
	rightBrowArch: number;
	mouthCurl: number;
	leftEyeOpen: number;
	rightEyeOpen: number;
	leftUpperLid: number;
	rightUpperLid: number;
	leftWink: number;
	rightWink: number;
}

/** What an emote sets at one moment. Anything it leaves out stays at rest. */
export type BlonkyEmoteSample = Partial<BlonkyEmoteOffset> & Pick<BlonkyEmoteOffset, 'presence'>;

export interface BlonkyEmotePose {
	kind: BlonkyEmote | 'rest';
	elapsed: number;
	direction: -1 | 1;
	heldElapsed?: number;
	transitionFrom?: BlonkyEmoteOffset;
}

export interface BlonkyPalette {
	outlineInk: string;
	shirt: string;
	shirtTextureAlpha: number;
	shirtTextureInk: string;
}

/**
 * Which way Blonky is looking, from straight out at the viewer (0, 0): x
 * across the screen and y down it, each from -1 to 1.
 */
export interface BlonkyGaze {
	x: number;
	y: number;
}

export interface BlonkyDrawOptions {
	palette?: BlonkyPalette;
	emote?: BlonkyEmotePose;
	gaze?: BlonkyGaze;
	showArms?: boolean;
	showBody?: boolean;
	showHead?: boolean;
	/** How a painter shades its figure; lit by default. */
	shading?: BlonkyShading;
	view?: BlonkyView;
}
