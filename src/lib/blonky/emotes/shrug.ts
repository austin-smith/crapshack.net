import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleShrugEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Brace and glance begin together, then the inhale builds through the staggered
	// shoulders and torso. Its lead-in starts one ink frame earlier while the peak,
	// hold, and release timings stay fixed so the exhale remains unchanged.
	const brace = heldEnvelope(elapsed, 0, INK_FRAME_SECONDS, INK_FRAME_SECONDS, INK_FRAME_SECONDS);
	const glance = heldEnvelope(elapsed, 0, INK_FRAME_SECONDS, 0.75, 0.25);
	const firstShoulder = heldEnvelope(elapsed, INK_FRAME_SECONDS, 0.375, 0.375, 0.25);
	const secondShoulder = heldEnvelope(elapsed, INK_FRAME_SECONDS * 2, 0.375, 0.375, 0.25);
	const torsoFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS * 3, 0.375, 0.25, 0.375);
	const settle = heldEnvelope(elapsed, 1.125, INK_FRAME_SECONDS, 0, INK_FRAME_SECONDS * 2);
	const leftShoulder = direction < 0 ? firstShoulder : secondShoulder;
	const rightShoulder = direction > 0 ? firstShoulder : secondShoulder;
	const averageShoulder = (leftShoulder + rightShoulder) / 2;
	const compressedShoulders = Math.min(leftShoulder, rightShoulder);
	const shoulderDifference = (rightShoulder - leftShoulder) / 2;
	const shoulderLift = 12.5;
	const leftEyePinch = direction < 0 ? 0.17 : 0.07;
	const rightEyePinch = direction > 0 ? 0.17 : 0.07;

	return {
		presence: Math.max(brace, glance, firstShoulder, secondShoulder, settle),
		headX: direction * glance * 0.75,
		headY: brace * 0.45 + compressedShoulders * 2.7 + settle * 0.9,
		headAngle: direction * glance * -0.012,
		headTurn: direction * glance * 0.38,
		faceLookY: averageShoulder * 0.35,
		eyeLookY: 0,
		bodyX: direction * averageShoulder * -0.5,
		shoulderY: brace * 1.4 - averageShoulder * shoulderLift + settle * 1.2,
		torsoY: brace * 0.35 - torsoFollow * 1.8 + settle * 0.55,
		shoulderTilt: shoulderDifference * shoulderLift,
		bellySpread: brace * 0.45 - torsoFollow * 1.5 + settle * 0.9,
		mouthPurse: compressedShoulders * 0.48,
		mouthTension: direction * glance * 0.42,
		leftBrowLift: glance * (direction < 0 ? 2.8 : 1.4),
		rightBrowLift: glance * (direction > 0 ? 2.8 : 1.4),
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: 1 - glance * leftEyePinch - settle * 0.24,
		rightEyeOpen: 1 - glance * rightEyePinch - settle * 0.24,
	};
}
