import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleConfusedEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	const presence = heldEnvelope(elapsed, 0, 0.25, 0.75, 0.375);
	const shoulderFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS, 0.25, 0.625, 0.375);
	const bellyFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS * 2, 0.25, 0.5, 0.375);

	return {
		presence,
		headX: direction * presence * 1.2,
		headY: presence * 0.6,
		headAngle: direction * presence * 0.026,
		headTurn: direction * presence * 0.42,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: direction * shoulderFollow * 0.65,
		shoulderY: shoulderFollow * 0.18,
		torsoY: shoulderFollow * 0.18,
		shoulderTilt: direction * shoulderFollow * 1.05,
		bellySpread: bellyFollow * 0.4,
		mouthPurse: 0,
		mouthTension: direction * presence * 0.58,
		leftBrowLift: presence * (direction < 0 ? 4.4 : -0.8),
		rightBrowLift: presence * (direction > 0 ? 4.4 : -0.8),
		leftEyeOpen: 1,
		rightEyeOpen: 1,
	};
}
