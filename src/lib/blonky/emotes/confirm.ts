import { heldEnvelope, INK_FRAME_SECONDS, smoothstep } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleConfirmEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	const presence = heldEnvelope(elapsed, 0, 0.25, 0.375, 0.375);
	const down = heldEnvelope(elapsed, 0.125, 0.25, 0.125, 0.25);
	const shoulderFollow = heldEnvelope(elapsed, 0.125 + INK_FRAME_SECONDS, 0.25, 0.125, 0.25);
	const bellyFollow = heldEnvelope(elapsed, 0.125 + INK_FRAME_SECONDS * 2, 0.25, 0, 0.25);

	return {
		presence,
		headX: 0,
		headY: down * 3.4 - presence * 0.4,
		headAngle: direction * presence * 0.003,
		headTurn: direction * presence * 0.16,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: 0,
		shoulderY: shoulderFollow * 1.2,
		torsoY: shoulderFollow * 1.2,
		shoulderTilt: direction * shoulderFollow * 0.14,
		bellySpread: bellyFollow * 0.75,
		mouthPurse: 0,
		mouthTension: direction * presence * 0.24,
		leftBrowLift: presence * 0.55,
		rightBrowLift: presence * 0.55,
		leftEyeOpen: 1,
		rightEyeOpen: 1,
	};
}

export function sampleConfirmExit(from: BlonkyEmoteOffset, elapsed: number): BlonkyEmoteOffset {
	const eyeReturn = smoothstep(elapsed / INK_FRAME_SECONDS);
	const headReturn = smoothstep((elapsed - INK_FRAME_SECONDS) / (INK_FRAME_SECONDS * 2));
	const bodyReturn = smoothstep((elapsed - INK_FRAME_SECONDS * 2) / (INK_FRAME_SECONDS * 2));
	const settle = heldEnvelope(elapsed, INK_FRAME_SECONDS * 3, INK_FRAME_SECONDS, 0, INK_FRAME_SECONDS * 2);
	const blendToRest = (value: number, amount: number, resting = 0): number => (
		value + (resting - value) * amount
	);

	return {
		presence: Math.max(1 - bodyReturn, settle * 0.5),
		headX: blendToRest(from.headX, headReturn),
		headY: blendToRest(from.headY, headReturn) + settle * 1.1,
		headAngle: blendToRest(from.headAngle, headReturn) - from.headAngle * settle * 0.35,
		headTurn: blendToRest(from.headTurn, headReturn) - from.headTurn * settle * 0.3,
		faceLookY: blendToRest(from.faceLookY, headReturn),
		eyeLookY: blendToRest(from.eyeLookY, eyeReturn),
		bodyX: blendToRest(from.bodyX, bodyReturn),
		shoulderY: blendToRest(from.shoulderY, bodyReturn) + settle * 0.4,
		torsoY: blendToRest(from.torsoY, bodyReturn) + settle * 0.4,
		shoulderTilt: blendToRest(from.shoulderTilt, bodyReturn),
		bellySpread: blendToRest(from.bellySpread, bodyReturn) - settle * 0.25,
		mouthPurse: blendToRest(from.mouthPurse, headReturn),
		mouthTension: blendToRest(from.mouthTension, headReturn),
		leftBrowLift: blendToRest(from.leftBrowLift, headReturn),
		rightBrowLift: blendToRest(from.rightBrowLift, headReturn),
		leftEyeOpen: blendToRest(from.leftEyeOpen, eyeReturn, 1),
		rightEyeOpen: blendToRest(from.rightEyeOpen, eyeReturn, 1),
	};
}
