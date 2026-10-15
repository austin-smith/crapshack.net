import { smoothstep } from '../motion';
import { confirmEmote } from './confirm';
import { cryEmote } from './cry';
import { denyEmote } from './deny';
import { nodOffEmote } from './nod-off';
import { noticeEmote } from './notice';
import { shrugEmote } from './shrug';
import { shudderEmote } from './shudder';
import { sighEmote } from './sigh';
import { skepticalEmote } from './skeptical';
import { smhEmote } from './smh';
import { waveEmote, WAVE_RELEASE_SECONDS } from './wave';
import { winkEmote } from './wink';
import {
	BLONKY_EMOTE_TRANSITION_FRAMES,
	BLONKY_FPS,
	type BlonkyEmoteDefinition,
	type BlonkyEmoteOffset,
	type BlonkyEmotePose,
	type BlonkyEmoteSample,
} from '../types';

/** Every emote Blonky knows, in the order the lab and his menu list them. */
export const BLONKY_EMOTES = {
	confirm: confirmEmote,
	cry: cryEmote,
	deny: denyEmote,
	'nod-off': nodOffEmote,
	notice: noticeEmote,
	shrug: shrugEmote,
	shudder: shudderEmote,
	sigh: sighEmote,
	skeptical: skepticalEmote,
	smh: smhEmote,
	wave: waveEmote,
	wink: winkEmote,
} as const satisfies Record<string, BlonkyEmoteDefinition>;

export type BlonkyEmote = keyof typeof BLONKY_EMOTES;

const REST_OFFSET: Readonly<BlonkyEmoteOffset> = {
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

const OFFSET_KEYS = Object.keys(REST_OFFSET) as (keyof BlonkyEmoteOffset)[];

const WAVE_KEYS = [
	'leftWave',
	'rightWave',
	'leftWaveSwing',
	'rightWaveSwing',
	'leftWaveFingers',
	'rightWaveFingers',
] as const satisfies readonly (keyof BlonkyEmoteOffset)[];

function fromRest(sample: BlonkyEmoteSample): BlonkyEmoteOffset {
	return { ...REST_OFFSET, ...sample };
}

function blendEmoteOffsets(
	from: BlonkyEmoteOffset,
	to: BlonkyEmoteOffset,
	amount: number,
): BlonkyEmoteOffset {
	const result = { ...to };
	for (const key of OFFSET_KEYS) result[key] = from[key] + (to[key] - from[key]) * amount;
	return result;
}

function rawEmoteOffsetAt(emote: BlonkyEmotePose): BlonkyEmoteOffset {
	if (emote.kind === 'rest') return { ...REST_OFFSET };

	const definition: BlonkyEmoteDefinition = BLONKY_EMOTES[emote.kind];
	const elapsed = Math.max(0, Math.min(definition.duration, emote.elapsed));
	return fromRest(definition.sample(elapsed, emote.direction, emote.heldElapsed));
}

export function isBlonkyEmote(value: unknown): value is BlonkyEmote {
	return typeof value === 'string' && Object.hasOwn(BLONKY_EMOTES, value);
}

const raisesArm = (offset?: BlonkyEmoteOffset): boolean => (
	(offset?.leftWave ?? 0) > 0 || (offset?.rightWave ?? 0) > 0
);

export function blonkyTransitionSeconds(from?: BlonkyEmoteOffset): number {
	return raisesArm(from)
		? WAVE_RELEASE_SECONDS
		: BLONKY_EMOTE_TRANSITION_FRAMES / BLONKY_FPS;
}

export function sampleBlonkyEmoteOffset(emote?: BlonkyEmotePose): BlonkyEmoteOffset {
	if (!emote) return { ...REST_OFFSET };
	const from = emote.transitionFrom;
	if (!from) return rawEmoteOffsetAt(emote);
	const definition: BlonkyEmoteDefinition | undefined = emote.kind === 'rest'
		? undefined
		: BLONKY_EMOTES[emote.kind];
	const interrupting = definition?.interrupting;
	const current = interrupting
		? fromRest(interrupting(from, emote.elapsed))
		: rawEmoteOffsetAt(emote);
	const transitionFrame = Math.max(0, Math.floor(emote.elapsed * BLONKY_FPS + 1e-6));
	const transition = Math.min(1, transitionFrame / BLONKY_EMOTE_TRANSITION_FRAMES);
	const result = interrupting ? current : blendEmoteOffsets(from, current, transition);
	// A face can change in two drawings. A raised arm needs time to lower,
	// even when a new reaction interrupts the greeting.
	if (raisesArm(from)) {
		const armReturn = smoothstep(emote.elapsed / WAVE_RELEASE_SECONDS);
		for (const key of WAVE_KEYS) {
			result[key] = from[key] + (current[key] - from[key]) * armReturn;
		}
	}
	return result;
}

export type {
	BlonkyEmoteDefinition,
	BlonkyEmoteOffset,
	BlonkyEmotePose,
} from '../types';
