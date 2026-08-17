import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleShudderEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Disgust reaches the face first. Blonky then braces into one broad, heavy
	// recoil while two short contractions pass through his shoulders. The torso
	// follows late and settles last, keeping the motion weighty without turning
	// the shudder itself into a slow shrug.
	const revulsion = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * 4,
	);
	const brace = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 4,
	);
	const firstContraction = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 3,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const secondContraction = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const torsoFollow = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 3,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 4,
	);
	const weightSettle = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS * 2,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const contraction = firstContraction + secondContraction * 0.55;
	const recoil = direction * (firstContraction - secondContraction * 0.55);

	return {
		presence: Math.max(revulsion, brace, firstContraction, secondContraction, torsoFollow, weightSettle),
		headX: recoil * 2.6,
		headY: brace * 3.2 + contraction * 1.6 + torsoFollow * 0.6 + weightSettle * 1.2,
		headAngle: recoil * 0.015,
		headTurn: recoil * 0.18,
		faceLookY: brace * 0.55 + torsoFollow * 0.35,
		eyeLookY: brace * 0.25,
		bodyX: direction * torsoFollow * 0.7 - recoil * 0.5,
		shoulderY: -brace * 7 - contraction * 4.5 + weightSettle * 4.5,
		torsoY: -torsoFollow * 2.4 + weightSettle * 3.2,
		shoulderTilt: recoil * 3.5,
		bellySpread: -torsoFollow * 3.5 + weightSettle * 3,
		mouthPurse: revulsion * 0.44 + contraction * 0.12,
		mouthTension: direction * revulsion * 0.18 + recoil * 0.18,
		leftBrowLift: -revulsion * 2.2 - recoil * 0.45,
		rightBrowLift: -revulsion * 2.2 + recoil * 0.45,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: direction * revulsion * 0.35 + recoil * 0.18,
		leftEyeOpen: 1 - revulsion * 0.38 - contraction * 0.12,
		rightEyeOpen: 1 - revulsion * 0.38 - contraction * 0.12,
	};
}
