import { heldEnvelope } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleWinkEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// A quick, deliberate squeeze: half-close, two shut drawings, half-open.
	// Keep the accompanying smirk small enough to retain his deadpan face.
	const presence = heldEnvelope(elapsed, 0, 0.125, 0.875, 0.5);
	const smile = heldEnvelope(elapsed, 0, 0.25, 0.5, 0.75);
	const wink = heldEnvelope(elapsed, 0.125, 0.25, 0.125, 0.25);
	const lean = heldEnvelope(elapsed, 0.125, 0.25, 0.25, 0.75);
	const left = direction < 0;
	return {
		presence,
		headX: direction * lean * 0.4,
		headY: lean * 0.4,
		headAngle: direction * lean * 0.008,
		headTurn: direction * lean * 0.06,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: 0,
		shoulderY: 0,
		torsoY: 0,
		shoulderTilt: 0,
		bellySpread: 0,
		mouthPurse: 0,
		mouthTension: 0,
		mouthSmile: smile * 0.5,
		mouthCurl: direction * smile * 0.14,
		leftBrowLift: left ? -wink * 2 : smile * 0.25,
		rightBrowLift: left ? smile * 0.25 : -wink * 2,
		leftBrowArch: 0,
		rightBrowArch: 0,
		leftEyeOpen: left ? 1 - wink : 1,
		rightEyeOpen: left ? 1 : 1 - wink,
		leftUpperLid: 0,
		rightUpperLid: 0,
		leftWink: left ? wink : 0,
		rightWink: left ? 0 : wink,
	};
}
