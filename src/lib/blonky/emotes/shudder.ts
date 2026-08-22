import { heldEnvelope, INK_FRAME_SECONDS, smoothstep } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

const BODY_WOBBLE_KEYS = [0, 1, -0.78, 0.54, -0.32, 0.15, 0];

function bodyWobbleAt(elapsed: number): number {
	const frame = elapsed / INK_FRAME_SECONDS - 7;
	if (frame <= 0 || frame >= BODY_WOBBLE_KEYS.length - 1) return 0;
	const index = Math.floor(frame);
	const amount = smoothstep(frame - index);
	return BODY_WOBBLE_KEYS[index]
		+ (BODY_WOBBLE_KEYS[index + 1] - BODY_WOBBLE_KEYS[index]) * amount;
}

export function sampleShudderEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// The head lowers once and stays planted while the shoulders close around it.
	// A single damped burst rocks the braced upper body beneath that fixed head;
	// each reversal tightens both shoulders rather than becoming a loose sway.
	const unease = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 5,
	);
	const headSet = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 4,
	);
	const cringe = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS * 3,
	);
	const torsoBrace = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS * 4,
	);
	const settle = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 14,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const bodyWobble = bodyWobbleAt(elapsed);
	const contraction = Math.abs(bodyWobble);
	const bodyWobbleX = direction * bodyWobble * 2.8;

	return {
		presence: Math.max(unease, headSet, cringe, torsoBrace, settle),
		armTension: cringe * 0.055 + contraction * 0.003,
		headX: -bodyWobbleX * 0.75,
		headY: headSet * 4,
		headAngle: 0,
		headTurn: 0,
		faceLookY: headSet * 1.9,
		eyeLookY: headSet * 1.55,
		bodyX: bodyWobbleX,
		shoulderY: -cringe * 12 + settle * 3.5,
		torsoY: -torsoBrace * 2.5 + settle * 2.8,
		shoulderTilt: 0,
		bellySpread: -torsoBrace * 3.5 + settle * 2.5,
		mouthPurse: unease * 0.18 + cringe * 0.5,
		mouthTension: 0,
		leftBrowLift: -unease * 1.4 - cringe * 0.75,
		rightBrowLift: -unease * 1.4 - cringe * 0.75,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: 1 - unease * 0.16 - cringe * 0.37,
		rightEyeOpen: 1 - unease * 0.16 - cringe * 0.37,
	};
}
