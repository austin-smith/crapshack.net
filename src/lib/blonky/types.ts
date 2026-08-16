export const BLONKY_BUST_WIDTH = 900;
export const BLONKY_BUST_HEIGHT = 800;
export const BLONKY_FPS = 8;
export const BLONKY_EMOTE_TRANSITION_FRAMES = 2;

export const BLONKY_VIEWPORTS = {
	bust: { width: BLONKY_BUST_WIDTH, height: BLONKY_BUST_HEIGHT },
	debug: { width: 940, height: BLONKY_BUST_HEIGHT },
	portrait: { width: 520, height: 520 },
} as const;

export type BlonkyView = keyof typeof BLONKY_VIEWPORTS;

export type BlonkyEmote = 'notice' | 'confirm' | 'skeptical' | 'shrug';

export interface BlonkyEmoteInfo {
	label: string;
	duration: number;
	holds?: boolean;
}

export interface BlonkyEmoteOffset {
	presence: number;
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
	leftBrowLift: number;
	rightBrowLift: number;
	leftBrowArch: number;
	rightBrowArch: number;
	mouthCurl: number;
	leftEyeOpen: number;
	rightEyeOpen: number;
}

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

export interface BlonkyDrawOptions {
	palette?: BlonkyPalette;
	emote?: BlonkyEmotePose;
	showBody?: boolean;
	showHead?: boolean;
	view?: BlonkyView;
}
