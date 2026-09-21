import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleSighEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Build the inhale over five ink frames. During the exhale, shoulders lead,
	// torso displacement stays smaller, and head motion begins three frames later.
	const inhale = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 5,
	);
	const exhale = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 7,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 6,
	);
	const headFollow = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 10,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 4,
	);
	const heavyLids = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS * 5,
	);

	return {
		presence: Math.max(inhale, exhale, headFollow, heavyLids),
		headX: direction * headFollow * 0.2,
		headY: -inhale * 0.55 + headFollow * 4,
		headAngle: direction * headFollow * 0.008,
		headTurn: direction * headFollow * 0.08,
		faceLookY: headFollow * 1.45,
		eyeLookY: headFollow * 1.2,
		bodyX: direction * exhale * 0.2,
		shoulderY: -inhale * 5 + exhale * 8.8,
		torsoY: -inhale * 0.65 + exhale * 2.6,
		shoulderTilt: direction * exhale * 0.35,
		bellySpread: inhale * 5.2 - exhale * 2.2,
		mouthPurse: inhale * 0.04 + exhale * 0.34,
		mouthTension: direction * exhale * 0.05,
		leftBrowLift: heavyLids * -0.4,
		rightBrowLift: heavyLids * -0.4,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: 1 - heavyLids * 0.38 - headFollow * 0.06,
		rightEyeOpen: 1 - heavyLids * 0.38 - headFollow * 0.06,
	};
}
