import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleNodOffEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// The eyelids lead, followed by the head, shoulders, and torso on successive
	// ink frames. Every part reaches the sleeping pose before the final dip.
	const firstLid = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 6,
		INK_FRAME_SECONDS,
	);
	const secondLid = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 5,
		INK_FRAME_SECONDS,
	);
	const headDrowse = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS,
	);
	const shoulderDrowse = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS * 3,
		INK_FRAME_SECONDS,
	);
	const torsoDrowse = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 3,
		INK_FRAME_SECONDS * 9,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS,
	);
	const finalDip = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 13,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS,
	);
	const wake = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 14,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 3,
	);
	const settle = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 16,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 4,
	);
	const sheepishBlink = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 18,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS,
	);
	const lidDrowse = (firstLid + secondLid) / 2;
	const leftLid = direction < 0 ? firstLid : secondLid;
	const rightLid = direction > 0 ? firstLid : secondLid;

	return {
		presence: Math.max(
			firstLid,
			secondLid,
			headDrowse,
			shoulderDrowse,
			torsoDrowse,
			finalDip,
			wake,
			settle,
			sheepishBlink,
		),
		headX: direction * (headDrowse * 1.4 + finalDip * 0.8 - wake * 0.7),
		headY: headDrowse * 9.5 + finalDip * 5.2 - wake * 7.5 + settle * 0.8,
		headAngle: direction * (headDrowse * 0.032 + finalDip * 0.015 - wake * 0.018),
		headTurn: direction * (headDrowse * 0.1 - wake * 0.08),
		faceLookY: headDrowse * 3.8 + finalDip * 1.5 - wake * 1.8,
		eyeLookY: lidDrowse * 2.2 - wake * 1.4,
		bodyX: direction * (shoulderDrowse * 0.35 - wake * 0.25),
		shoulderY: shoulderDrowse * 5.2 + finalDip * 1.8 - wake * 5.8 + settle * 0.9,
		torsoY: torsoDrowse * 1.8 + finalDip * 0.8 - wake * 2.4 + settle * 0.4,
		shoulderTilt: direction * (shoulderDrowse * 0.8 + finalDip * 0.6 - wake * 1.4),
		bellySpread: torsoDrowse * 1.6 + finalDip * 0.7 - wake * 2.1 + settle * 0.45,
		mouthPurse: headDrowse * 0.1 + settle * 0.04,
		mouthTension: direction * (headDrowse * -0.05 + wake * 0.16 - settle * 0.08),
		leftBrowLift: lidDrowse * -0.35 + wake * 4.2 + settle * 0.45,
		rightBrowLift: lidDrowse * -0.35 + wake * 4.2 + settle * 0.45,
		leftBrowArch: 0,
		rightBrowArch: 0,
		mouthCurl: direction * settle * -0.12,
		leftEyeOpen: 1 - leftLid * 0.88 - finalDip * 0.1 + wake * 0.22 - sheepishBlink * 0.82,
		rightEyeOpen: 1 - rightLid * 0.88 - finalDip * 0.1 + wake * 0.22 - sheepishBlink * 0.82,
	};
}
