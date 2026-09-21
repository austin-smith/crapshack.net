import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export const CRY_LINGER_FRAMES = 8;
export const CRY_DURATION_FRAMES = 26 + CRY_LINGER_FRAMES;

export function sampleCryEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// The expression crumples before the body gives way. One eye wells up a frame
	// before the other, then two uneven catches in the breath lift the shoulders.
	const grief = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * (16 + CRY_LINGER_FRAMES),
		INK_FRAME_SECONDS * 6,
	);
	const fold = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * (13 + CRY_LINGER_FRAMES),
		INK_FRAME_SECONDS * 6,
	);
	const firstCatch = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const secondCatch = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 14,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const catchBreath = firstCatch + secondCatch * 0.72;

	return {
		presence: Math.max(grief, fold),
		armTension: fold * 0.035 + catchBreath * 0.012,
		headX: direction * (fold * 0.8 + catchBreath * 0.35),
		headY: fold * 5.8 - catchBreath * 2.4,
		headAngle: direction * (fold * 0.015 + catchBreath * 0.006),
		headTurn: direction * fold * 0.08,
		faceLookY: fold * 1.8 - catchBreath * 0.7,
		eyeLookY: fold * 1.2,
		bodyX: direction * fold * 0.25,
		shoulderY: fold * 5.6 - catchBreath * 7.5,
		torsoY: fold * 2.4 - catchBreath * 1.1,
		shoulderTilt: direction * fold * 0.45,
		bellySpread: fold * 1.8 - catchBreath * 1.4,
		mouthPurse: grief * 0.16 + catchBreath * 0.16,
		mouthTension: direction * catchBreath * 0.08,
		mouthFrown: grief * 0.84 + catchBreath * 0.08,
		leftBrowLift: grief * 1.9,
		rightBrowLift: grief * 1.9,
		leftBrowArch: grief * -5.8,
		rightBrowArch: grief * -5.8,
		mouthCurl: 0,
		leftEyeOpen: 1 - grief * 0.72 - catchBreath * 0.05,
		rightEyeOpen: 1 - grief * 0.72 - catchBreath * 0.05,
	};
}
