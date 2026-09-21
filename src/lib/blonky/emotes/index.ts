import { smoothstep } from '../motion';
import { sampleConfirmEmote, sampleConfirmExit } from './confirm';
import { CRY_DURATION_FRAMES, sampleCryEmote } from './cry';
import { sampleDenyEmote } from './deny';
import { sampleNodOffEmote } from './nod-off';
import { sampleNoticeEmote } from './notice';
import { sampleShrugEmote } from './shrug';
import { sampleShudderEmote } from './shudder';
import { sampleSighEmote } from './sigh';
import { sampleSkepticalEmote } from './skeptical';
import { sampleSmhEmote } from './smh';
import { sampleWaveEmote, WAVE_DURATION, WAVE_RELEASE_SECONDS } from './wave';
import { sampleWinkEmote } from './wink';
import {
	BLONKY_EMOTE_TRANSITION_FRAMES,
	BLONKY_FPS,
	type BlonkyEmote,
	type BlonkyEmoteInfo,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
} from '../types';

export const BLONKY_EMOTES: Record<BlonkyEmote, BlonkyEmoteInfo> = {
	confirm: { label: 'confirm', duration: 1 },
	cry: { label: 'cry', duration: CRY_DURATION_FRAMES / BLONKY_FPS },
	deny: { label: 'deny', duration: 1.875 },
	'nod-off': { label: 'nod off', duration: 3 },
	notice: { label: 'notice', duration: 0.625, holds: true },
	shrug: { label: 'shrug', duration: 1.5 },
	shudder: { label: 'shudder', duration: 2.125 },
	sigh: { label: 'sigh', duration: 2.75 },
	skeptical: { label: 'skeptical', duration: 1.375 },
	smh: { label: 'smh', duration: 2.125 },
	wave: { label: 'wave', duration: WAVE_DURATION, stillFrame: 21 },
	wink: { label: 'wink', duration: 1.5, stillFrame: 3 },
};

const NO_EMOTE_OFFSET: BlonkyEmoteOffset = {
	presence: 0,
	leftWave: 0,
	rightWave: 0,
	leftWaveSwing: 0,
	rightWaveSwing: 0,
	leftWaveFingers: 0,
	rightWaveFingers: 0,
	armTension: 0,
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
	mouthFrown: 0,
	mouthSmile: 0,
	leftBrowLift: 0,
	rightBrowLift: 0,
	leftBrowArch: 0,
	rightBrowArch: 0,
	mouthCurl: 0,
	leftEyeOpen: 1,
	rightEyeOpen: 1,
	leftUpperLid: 0,
	rightUpperLid: 0,
	leftWink: 0,
	rightWink: 0,
};

function blendEmoteOffsets(
	from: BlonkyEmoteOffset,
	to: BlonkyEmoteOffset,
	amount: number,
): BlonkyEmoteOffset {
	const blend = (start: number, end: number): number => start + (end - start) * amount;
	return {
		presence: blend(from.presence, to.presence),
		leftWave: blend(from.leftWave ?? 0, to.leftWave ?? 0),
		rightWave: blend(from.rightWave ?? 0, to.rightWave ?? 0),
		leftWaveSwing: blend(from.leftWaveSwing ?? 0, to.leftWaveSwing ?? 0),
		rightWaveSwing: blend(from.rightWaveSwing ?? 0, to.rightWaveSwing ?? 0),
		leftWaveFingers: blend(from.leftWaveFingers ?? 0, to.leftWaveFingers ?? 0),
		rightWaveFingers: blend(from.rightWaveFingers ?? 0, to.rightWaveFingers ?? 0),
		armTension: blend(from.armTension ?? 0, to.armTension ?? 0),
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
		mouthFrown: blend(from.mouthFrown ?? 0, to.mouthFrown ?? 0),
		mouthSmile: blend(from.mouthSmile ?? 0, to.mouthSmile ?? 0),
		leftBrowLift: blend(from.leftBrowLift, to.leftBrowLift),
		rightBrowLift: blend(from.rightBrowLift, to.rightBrowLift),
		leftBrowArch: blend(from.leftBrowArch, to.leftBrowArch),
		rightBrowArch: blend(from.rightBrowArch, to.rightBrowArch),
		mouthCurl: blend(from.mouthCurl, to.mouthCurl),
		leftEyeOpen: blend(from.leftEyeOpen, to.leftEyeOpen),
		rightEyeOpen: blend(from.rightEyeOpen, to.rightEyeOpen),
		leftUpperLid: blend(from.leftUpperLid ?? 0, to.leftUpperLid ?? 0),
		rightUpperLid: blend(from.rightUpperLid ?? 0, to.rightUpperLid ?? 0),
		leftWink: blend(from.leftWink ?? 0, to.leftWink ?? 0),
		rightWink: blend(from.rightWink ?? 0, to.rightWink ?? 0),
	};
}

function rawEmoteOffsetAt(emote: BlonkyEmotePose): BlonkyEmoteOffset {
	if (emote.kind === 'rest') return { ...NO_EMOTE_OFFSET };

	const duration = BLONKY_EMOTES[emote.kind].duration;
	const elapsed = Math.max(0, Math.min(duration, emote.elapsed));

	switch (emote.kind) {
		case 'confirm':
			return sampleConfirmEmote(elapsed, emote.direction);
		case 'cry':
			return sampleCryEmote(elapsed, emote.direction);
		case 'deny':
			return sampleDenyEmote(elapsed, emote.direction);
		case 'nod-off':
			return sampleNodOffEmote(elapsed, emote.direction);
		case 'notice':
			return sampleNoticeEmote(elapsed, emote.direction, emote.heldElapsed);
		case 'shrug':
			return sampleShrugEmote(elapsed, emote.direction);
		case 'shudder':
			return sampleShudderEmote(elapsed, emote.direction);
		case 'sigh':
			return sampleSighEmote(elapsed, emote.direction);
		case 'skeptical':
			return sampleSkepticalEmote(elapsed, emote.direction);
		case 'smh':
			return sampleSmhEmote(elapsed, emote.direction);
		case 'wave':
			return sampleWaveEmote(elapsed, emote.direction);
		case 'wink':
			return sampleWinkEmote(elapsed, emote.direction);
	}
}

export function isBlonkyEmote(value: unknown): value is BlonkyEmote {
	return typeof value === 'string'
		&& Object.prototype.hasOwnProperty.call(BLONKY_EMOTES, value);
}

export function blonkyTransitionSeconds(from?: BlonkyEmoteOffset): number {
	return (from?.leftWave ?? 0) > 0 || (from?.rightWave ?? 0) > 0
		? WAVE_RELEASE_SECONDS
		: BLONKY_EMOTE_TRANSITION_FRAMES / BLONKY_FPS;
}

export function sampleBlonkyEmoteOffset(emote?: BlonkyEmotePose): BlonkyEmoteOffset {
	if (!emote) return { ...NO_EMOTE_OFFSET };
	const from = emote.transitionFrom;
	const confirmExit = emote.kind === 'confirm' && from;
	const current = confirmExit ? sampleConfirmExit(from, emote.elapsed) : rawEmoteOffsetAt(emote);
	if (!from) return current;
	const transitionFrame = Math.max(0, Math.floor(emote.elapsed * BLONKY_FPS + 1e-6));
	const transition = Math.min(1, transitionFrame / BLONKY_EMOTE_TRANSITION_FRAMES);
	const result = confirmExit ? current : blendEmoteOffsets(from, current, transition);
	// A face can change in two drawings. A raised arm needs time to lower,
	// even when a new reaction interrupts the greeting.
	if ((from.leftWave ?? 0) > 0 || (from.rightWave ?? 0) > 0) {
		const armReturn = smoothstep(emote.elapsed / WAVE_RELEASE_SECONDS);
		for (const key of ['leftWave', 'rightWave', 'leftWaveSwing', 'rightWaveSwing', 'leftWaveFingers', 'rightWaveFingers'] as const) {
			const start = from[key] ?? 0;
			result[key] = start + ((current[key] ?? 0) - start) * armReturn;
		}
	}
	return result;
}

export type {
	BlonkyEmote,
	BlonkyEmoteInfo,
	BlonkyEmoteOffset,
	BlonkyEmotePose,
} from '../types';
