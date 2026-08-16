import { sampleConfirmEmote, sampleConfirmExit } from './confirm';
import { sampleNoticeEmote } from './notice';
import { sampleSighEmote } from './sigh';
import { sampleSkepticalEmote } from './skeptical';
import { sampleShudderEmote } from './shudder';
import { sampleSmhEmote } from './smh';
import { sampleShrugEmote } from './shrug';
import {
	BLONKY_EMOTE_TRANSITION_FRAMES,
	BLONKY_FPS,
	type BlonkyEmote,
	type BlonkyEmoteInfo,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
} from '../types';

export const BLONKY_EMOTES: Record<BlonkyEmote, BlonkyEmoteInfo> = {
	notice: { label: 'notice', duration: 0.625, holds: true },
	confirm: { label: 'confirm', duration: 1 },
	skeptical: { label: 'skeptical', duration: 1.375 },
	shrug: { label: 'shrug', duration: 1.5 },
	shudder: { label: 'shudder', duration: 1.625 },
	smh: { label: 'smh', duration: 2.125 },
	sigh: { label: 'sigh', duration: 2.75 },
};

const NO_EMOTE_OFFSET: BlonkyEmoteOffset = {
	presence: 0,
	headX: 0,
	headY: 0,
	headAngle: 0,
	headTurn: 0,
	faceLookY: 0,
	eyeLookY: 0,
	bodyX: 0,
	shoulderY: 0,
	torsoY: 0,
	shoulderTilt: 0,
	bellySpread: 0,
	mouthPurse: 0,
	mouthTension: 0,
	leftBrowLift: 0,
	rightBrowLift: 0,
	leftBrowArch: 0,
	rightBrowArch: 0,
	mouthCurl: 0,
	leftEyeOpen: 1,
	rightEyeOpen: 1,
};

function blendEmoteOffsets(
	from: BlonkyEmoteOffset,
	to: BlonkyEmoteOffset,
	amount: number,
): BlonkyEmoteOffset {
	const blend = (start: number, end: number): number => start + (end - start) * amount;
	return {
		presence: blend(from.presence, to.presence),
		headX: blend(from.headX, to.headX),
		headY: blend(from.headY, to.headY),
		headAngle: blend(from.headAngle, to.headAngle),
		headTurn: blend(from.headTurn, to.headTurn),
		faceLookY: blend(from.faceLookY, to.faceLookY),
		eyeLookY: blend(from.eyeLookY, to.eyeLookY),
		bodyX: blend(from.bodyX, to.bodyX),
		shoulderY: blend(from.shoulderY, to.shoulderY),
		torsoY: blend(from.torsoY, to.torsoY),
		shoulderTilt: blend(from.shoulderTilt, to.shoulderTilt),
		bellySpread: blend(from.bellySpread, to.bellySpread),
		mouthPurse: blend(from.mouthPurse, to.mouthPurse),
		mouthTension: blend(from.mouthTension, to.mouthTension),
		leftBrowLift: blend(from.leftBrowLift, to.leftBrowLift),
		rightBrowLift: blend(from.rightBrowLift, to.rightBrowLift),
		leftBrowArch: blend(from.leftBrowArch, to.leftBrowArch),
		rightBrowArch: blend(from.rightBrowArch, to.rightBrowArch),
		mouthCurl: blend(from.mouthCurl, to.mouthCurl),
		leftEyeOpen: blend(from.leftEyeOpen, to.leftEyeOpen),
		rightEyeOpen: blend(from.rightEyeOpen, to.rightEyeOpen),
	};
}

function rawEmoteOffsetAt(emote: BlonkyEmotePose): BlonkyEmoteOffset {
	if (emote.kind === 'rest') return { ...NO_EMOTE_OFFSET };

	const duration = BLONKY_EMOTES[emote.kind].duration;
	const elapsed = Math.max(0, Math.min(duration, emote.elapsed));

	switch (emote.kind) {
		case 'notice':
			return sampleNoticeEmote(elapsed, emote.direction, emote.heldElapsed);
		case 'confirm':
			return sampleConfirmEmote(elapsed, emote.direction);
		case 'skeptical':
			return sampleSkepticalEmote(elapsed, emote.direction);
		case 'shrug':
			return sampleShrugEmote(elapsed, emote.direction);
		case 'shudder':
			return sampleShudderEmote(elapsed, emote.direction);
		case 'smh':
			return sampleSmhEmote(elapsed, emote.direction);
		case 'sigh':
			return sampleSighEmote(elapsed, emote.direction);
	}
}

export function isBlonkyEmote(value: unknown): value is BlonkyEmote {
	return typeof value === 'string'
		&& Object.prototype.hasOwnProperty.call(BLONKY_EMOTES, value);
}

export function sampleBlonkyEmoteOffset(emote?: BlonkyEmotePose): BlonkyEmoteOffset {
	if (!emote) return { ...NO_EMOTE_OFFSET };
	if (emote.kind === 'confirm' && emote.transitionFrom) {
		return sampleConfirmExit(emote.transitionFrom, emote.elapsed);
	}
	const current = rawEmoteOffsetAt(emote);
	if (!emote.transitionFrom) return current;
	const transitionFrame = Math.max(0, Math.floor(emote.elapsed * BLONKY_FPS + 1e-6));
	const transition = Math.min(1, transitionFrame / BLONKY_EMOTE_TRANSITION_FRAMES);
	return blendEmoteOffsets(emote.transitionFrom, current, transition);
}

export type {
	BlonkyEmote,
	BlonkyEmoteInfo,
	BlonkyEmoteOffset,
	BlonkyEmotePose,
} from '../types';
