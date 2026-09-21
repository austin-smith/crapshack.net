import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleSmhEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Facial tension precedes four overlapping yaw sweeps. Torso offsets begin
	// after head yaw approaches zero.
	const judgment = heldEnvelope(elapsed, 0, 0.25, 1.5, 0.375);
	const downLook = heldEnvelope(elapsed, INK_FRAME_SECONDS, 0.25, 1.25, 0.375);
	const eyeClose = heldEnvelope(elapsed, 0.25, 0.25, 1, 0.375);
	const firstSweep = heldEnvelope(elapsed, 0.25, 0.25, INK_FRAME_SECONDS, 0.25);
	const secondSweep = heldEnvelope(elapsed, 0.5, 0.25, INK_FRAME_SECONDS, 0.25);
	const returnSweep = heldEnvelope(elapsed, 0.75, 0.25, INK_FRAME_SECONDS, 0.25);
	const finalSweep = heldEnvelope(elapsed, 1, 0.25, INK_FRAME_SECONDS, 0.25);
	const yaw = direction * (
		firstSweep
		- secondSweep
		+ returnSweep * 0.58
		- finalSweep * 0.28
	);
	const release = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 13,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 3,
	);

	return {
		presence: Math.max(judgment, firstSweep, secondSweep, returnSweep, finalSweep, release),
		headX: yaw * 0.25,
		headY: downLook * 1.45 + release * 0.65,
		headAngle: yaw * 0.004,
		headTurn: yaw * 1.6,
		faceLookY: downLook * 1.15,
		eyeLookY: downLook * 1.7,
		bodyX: 0,
		shoulderY: release * 1.15,
		torsoY: release * 0.6,
		shoulderTilt: yaw * -0.65,
		bellySpread: release * 0.95,
		mouthPurse: judgment * 0.08,
		mouthTension: yaw * 0.06,
		leftBrowLift: judgment * -0.65,
		rightBrowLift: judgment * -0.65,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: 1 - judgment * 0.12 - eyeClose * 0.43,
		rightEyeOpen: 1 - judgment * 0.12 - eyeClose * 0.43,
	};
}
