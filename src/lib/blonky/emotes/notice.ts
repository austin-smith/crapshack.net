import { blinkPoseAt, heldEnvelope, INK_FRAME_SECONDS, inkFrameTime } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleNoticeEmote(
	elapsed: number,
	direction: -1 | 1,
	heldElapsed?: number,
): BlonkyEmoteOffset {
	// Gaze, head, shoulders, and belly arrive on successive ink frames.
	const firstEyeBeat = heldEnvelope(elapsed, 0, 0.125, 0, 0.125);
	const secondEyeBeat = heldEnvelope(elapsed, 0.125, 0.125, 0, 0.125);
	const gaze = heldEnvelope(elapsed, 0, 0.125, 0.5, 0.25);
	const headFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS, 0.125, 0.375, 0.25);
	// Quantize a zero-based held clock to preserve the rest-state blink sequence.
	const heldBlink = heldElapsed === undefined
		? undefined
		: blinkPoseAt(inkFrameTime(heldElapsed));
	const shoulderFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS * 2, 0.125, 0.25, 0.25);
	const bellyFollow = heldEnvelope(elapsed, INK_FRAME_SECONDS * 3, 0.125, 0.125, 0.25);
	const leftEyeLeads = direction < 0;
	const leftEyeClosure = leftEyeLeads
		? firstEyeBeat * 0.58 + secondEyeBeat * 0.22
		: firstEyeBeat * 0.22 + secondEyeBeat * 0.48;
	const rightEyeClosure = leftEyeLeads
		? firstEyeBeat * 0.22 + secondEyeBeat * 0.48
		: firstEyeBeat * 0.58 + secondEyeBeat * 0.22;

	return {
		presence: Math.max(firstEyeBeat, secondEyeBeat, gaze, headFollow),
		headX: 0,
		headY: -headFollow * 3.8,
		headAngle: direction * headFollow * 0.009,
		headTurn: direction * headFollow * 0.14,
		faceLookY: -headFollow * 2.1,
		eyeLookY: -gaze * 4.2,
		bodyX: 0,
		shoulderY: -shoulderFollow * 1.15,
		torsoY: -shoulderFollow * 1.15,
		shoulderTilt: 0,
		bellySpread: bellyFollow * 0.85,
		mouthPurse: 0,
		mouthTension: headFollow * 0.08,
		leftBrowLift: gaze * 4.9,
		rightBrowLift: gaze * 4.5,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: 0,
		leftEyeOpen: (heldBlink?.leftEyeOpen ?? 1 - leftEyeClosure) + gaze * 0.035,
		rightEyeOpen: (heldBlink?.rightEyeOpen ?? 1 - rightEyeClosure) + gaze * 0.035,
	};
}
