import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleShudderEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Begin with tension, then alternate three shoulder contractions on
	// consecutive ink frames. Counter-rotate the head and delay belly compression
	// to produce torsion without translating the full pose.
	const brace = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * 3,
	);
	const firstContraction = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS,
	);
	const secondContraction = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS,
	);
	const thirdContraction = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS,
	);
	const settle = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 3,
	);
	const contraction = firstContraction + secondContraction * 0.76 + thirdContraction * 0.42;
	const asymmetry = direction * (
		firstContraction
		- secondContraction * 0.76
		+ thirdContraction * 0.42
	);
	const settleBias = -direction * settle;

	return {
		presence: Math.max(brace, contraction, settle),
		headX: asymmetry * 2.4 + settleBias * 0.45,
		headY: brace * 0.9 + contraction * 1.45 + settle * 0.9,
		headAngle: asymmetry * 0.014 + settleBias * 0.0025,
		headTurn: asymmetry * 0.2,
		faceLookY: brace * 0.4 + contraction * 0.35,
		eyeLookY: 0,
		bodyX: asymmetry * -1.55 + settleBias * 0.25,
		shoulderY: -brace * 3.4 - contraction * 4.2 + settle * 1.7,
		torsoY: -brace * 0.6 - contraction * 1.55 + settle * 1.1,
		shoulderTilt: asymmetry * 4.6 + settleBias * 0.85,
		bellySpread: -brace * 0.8 - contraction * 1.8 + settle * 1.15,
		mouthPurse: brace * 0.16 + contraction * 0.12,
		mouthTension: asymmetry * 0.12,
		leftBrowLift: -brace * 1.1,
		rightBrowLift: -brace * 1.1,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: 1 - brace * 0.22 - contraction * 0.08,
		rightEyeOpen: 1 - brace * 0.22 - contraction * 0.08,
	};
}
