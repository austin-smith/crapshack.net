import { heldEnvelope } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleSkepticalEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	const presence = heldEnvelope(elapsed, 0, 0.25, 0.75, 0.375);
	const leftBrowLeads = direction < 0;
	const raisedBrow = leftBrowLeads
		? heldEnvelope(elapsed, 0, 0.375, 0.625, 0.375)
		: presence;

	return {
		presence,
		headX: direction * presence * 1.35,
		headY: presence * 0.6,
		headAngle: direction * presence * 0.038,
		headTurn: direction * presence * 0.48,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: 0,
		shoulderY: 0,
		torsoY: 0,
		shoulderTilt: 0,
		bellySpread: 0,
		mouthPurse: 0,
		mouthTension: direction * presence * 0.36,
		leftBrowLift: leftBrowLeads ? raisedBrow * 6.2 : presence * -3.5,
		rightBrowLift: leftBrowLeads ? presence * -3.5 : raisedBrow * 6.2,
		leftBrowArch: leftBrowLeads ? raisedBrow * 7 : 0,
		rightBrowArch: leftBrowLeads ? 0 : raisedBrow * 7,
		mouthCurl: direction * presence * 1.05,
		leftEyeOpen: 1 + (leftBrowLeads ? raisedBrow * 0.04 : 0),
		rightEyeOpen: 1 + (leftBrowLeads ? 0 : raisedBrow * 0.04),
		leftUpperLid: leftBrowLeads ? 0 : presence * 0.38,
		rightUpperLid: leftBrowLeads ? presence * 0.38 : 0,
	};
}
