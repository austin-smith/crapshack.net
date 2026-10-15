import { sampleBlonkyEmoteOffset } from '../emotes';
import {
	blinkPoseAt,
	heldEnvelope,
	INK_FRAME_SECONDS,
	inkFrameTime,
	smoothstep,
} from '../motion';
import { hash } from '../noise';
import type { BlonkyEmotePose } from '../types';
import type { Pt } from './points';

const BEHAVIOR_PHRASE_SECONDS = 16.25;
const BREATH_CYCLE_SECONDS = 4.5;
const BREATH_INHALE_SECONDS = 1.5;
const BREATH_HOLD_SECONDS = 0.25;
const BREATH_EXHALE_SECONDS = 2.25;

export interface Pose {
	centerX: number;
	armTension: number;
	leftWave: number;
	rightWave: number;
	leftWaveSwing: number;
	rightWaveSwing: number;
	leftWaveFingers: number;
	rightWaveFingers: number;
	shoulderY: number;
	torsoY: number;
	leftShoulderY: number;
	rightShoulderY: number;
	headX: number;
	headY: number;
	headAngle: number;
	headEmoteAngle: number;
	headTurn: number;
	faceLookY: number;
	eyeLookY: number;
	breath: number;
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
	cryElapsed?: number;
	cryDirection?: -1 | 1;
	leftArm: [Pt, Pt, Pt];
	rightArm: [Pt, Pt, Pt];
}

interface IdleBehavior {
	deepBreath: number;
	headCorrection: number;
	mouthSet: number;
}

function idleBehaviorAt(time: number): IdleBehavior {
	const phrase = Math.floor(time / BEHAVIOR_PHRASE_SECONDS);
	const phraseTime = time - phrase * BEHAVIOR_PHRASE_SECONDS;
	const direction = hash(5297, phrase, 1) > 0.5 ? 1 : -1;
	const correctionStart = inkFrameTime(6.1 + hash(5297, phrase, 2) * 2.25);
	const breathStart = inkFrameTime(correctionStart + 3.15 + hash(5297, phrase, 3) * 0.9);

	return {
		// Hold the correction across several ink frames, then return it before
		// the later deep-breath envelope begins.
		headCorrection: direction * heldEnvelope(phraseTime, correctionStart, 0.5, 0.75, 0.7),
		mouthSet: direction * heldEnvelope(phraseTime, correctionStart + 0.25, 0.25, 0.42, 0.45),
		deepBreath: heldEnvelope(phraseTime, breathStart, 0.85, 0.2, 1.1),
	};
}

function breathAt(time: number): number {
	const cycleTime = ((time % BREATH_CYCLE_SECONDS) + BREATH_CYCLE_SECONDS)
		% BREATH_CYCLE_SECONDS;
	if (cycleTime < BREATH_INHALE_SECONDS) {
		return smoothstep(cycleTime / BREATH_INHALE_SECONDS);
	}
	if (cycleTime < BREATH_INHALE_SECONDS + BREATH_HOLD_SECONDS) return 1;
	const exhaleTime = cycleTime - BREATH_INHALE_SECONDS - BREATH_HOLD_SECONDS;
	if (exhaleTime < BREATH_EXHALE_SECONDS) {
		return 1 - smoothstep(exhaleTime / BREATH_EXHALE_SECONDS);
	}
	return 0;
}

export function poseAtRest(time: number, emote?: BlonkyEmotePose): Pose {
	const behavior = idleBehaviorAt(time);
	const emoteOffset = sampleBlonkyEmoteOffset(emote);
	const idleBehaviorWeight = 1 - emoteOffset.presence * 0.85;
	const breathDepth = 1 + behavior.deepBreath * 0.45 * idleBehaviorWeight;
	const breath = breathAt(time) * breathDepth;
	const shoulderBreath = breathAt(time - INK_FRAME_SECONDS) * breathDepth;
	const swayPhase = time * 0.86;
	const sway = Math.sin(swayPhase) * 2.8;
	const centerX = 450 + sway + emoteOffset.bodyX;
	const restingShoulderY = 294 - shoulderBreath * 3.8;
	const shoulderY = restingShoulderY + emoteOffset.shoulderY;
	const torsoY = 294 - breath * 0.9 + emoteOffset.torsoY;
	const leftShoulderY = shoulderY + 3.4 + Math.sin(swayPhase - 0.2) * 0.65 + emoteOffset.shoulderTilt;
	const rightShoulderY = shoulderY - 1.6 + Math.sin(swayPhase + 0.35) * 0.45 - emoteOffset.shoulderTilt;
	const armSway = Math.sin(swayPhase - 0.24) * 2.25;
	const armBreath = breathAt(time - INK_FRAME_SECONDS * 2) * breathDepth;
	const armBodyX = emoteOffset.bodyX * 0.65;
	const armBodyY = emoteOffset.torsoY * 0.35;
	const { leftEyeOpen, rightEyeOpen } = blinkPoseAt(time);
	const leftArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway + armBodyX - 341, y: leftShoulderY + 320 },
		{ x: 450 + armSway + armBodyX - 358, y: 742 - armBreath * 1.4 + armBodyY },
		{ x: 450 + armSway + armBodyX - 349, y: 846 + armBodyY * 0.4 },
	];
	const rightArm: [Pt, Pt, Pt] = [
		{ x: 450 + armSway + armBodyX + 342, y: rightShoulderY + 318 },
		{ x: 450 + armSway + armBodyX + 363, y: 745 - armBreath * 1.2 + armBodyY },
		{ x: 450 + armSway + armBodyX + 352, y: 846 + armBodyY * 0.4 },
	];

	return {
		centerX,
		armTension: emoteOffset.armTension,
		leftWave: emoteOffset.leftWave,
		rightWave: emoteOffset.rightWave,
		leftWaveSwing: emoteOffset.leftWaveSwing,
		rightWaveSwing: emoteOffset.rightWaveSwing,
		leftWaveFingers: emoteOffset.leftWaveFingers,
		rightWaveFingers: emoteOffset.rightWaveFingers,

		shoulderY,
		torsoY,
		leftShoulderY,
		rightShoulderY,
		headX: centerX - 5 + Math.sin(swayPhase - 0.43) * 1.45 + behavior.headCorrection * 1.2 * idleBehaviorWeight + emoteOffset.headX,
		headY: 295 - shoulderBreath * 0.35 + emoteOffset.headY,
		headAngle: -0.024 + Math.sin(swayPhase - 0.48) * 0.009 + behavior.headCorrection * 0.008 * idleBehaviorWeight,
		headEmoteAngle: emoteOffset.headAngle,
		headTurn: Math.sin(time * 0.7 - 0.4) * 0.24 + behavior.headCorrection * 0.82 * idleBehaviorWeight + emoteOffset.headTurn,
		faceLookY: emoteOffset.faceLookY,
		eyeLookY: emoteOffset.eyeLookY,
		breath: breath * 1.5,
		bellySpread: breath * 6.2 + emoteOffset.bellySpread,
		mouthPurse: emoteOffset.mouthPurse,
		mouthTension: behavior.mouthSet * idleBehaviorWeight + emoteOffset.mouthTension,
		mouthFrown: emoteOffset.mouthFrown,
		mouthSmile: emoteOffset.mouthSmile,
		leftBrowLift: emoteOffset.leftBrowLift,
		rightBrowLift: emoteOffset.rightBrowLift,
		leftBrowArch: emoteOffset.leftBrowArch,
		rightBrowArch: emoteOffset.rightBrowArch,
		mouthCurl: emoteOffset.mouthCurl,
		leftEyeOpen: leftEyeOpen + (emoteOffset.leftEyeOpen - leftEyeOpen) * emoteOffset.presence,
		rightEyeOpen: rightEyeOpen + (emoteOffset.rightEyeOpen - rightEyeOpen) * emoteOffset.presence,
		leftUpperLid: emoteOffset.leftUpperLid,
		rightUpperLid: emoteOffset.rightUpperLid,
		leftWink: emoteOffset.leftWink,
		rightWink: emoteOffset.rightWink,
		cryElapsed: emote?.kind === 'cry' ? emote.elapsed : undefined,
		cryDirection: emote?.kind === 'cry' ? emote.direction : undefined,
		leftArm,
		rightArm,
	};
}
