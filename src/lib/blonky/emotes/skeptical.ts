import { heldEnvelope } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

export function sampleSkepticalEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	const presence = heldEnvelope(elapsed, 0, 0.25, 0.75, 0.375);
	const leftBrowLeads = direction < 0;

	return {
		presence,
		headX: direction * presence * 1.05,
		headY: presence * 0.45,
		headAngle: direction * presence * 0.03,
		headTurn: direction * presence * 0.4,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: 0,
		shoulderY: 0,
		torsoY: 0,
		shoulderTilt: 0,
		bellySpread: 0,
		mouthPurse: 0,
		mouthTension: direction * presence * 0.32,
		leftBrowLift: presence * (leftBrowLeads ? 5.4 : -1.1),
		rightBrowLift: presence * (leftBrowLeads ? -1.1 : 5.4),
		leftBrowArch: presence * (leftBrowLeads ? 6.2 : 0),
		rightBrowArch: presence * (leftBrowLeads ? 0 : 6.2),
		mouthCurl: direction * presence * 0.9,
		leftEyeOpen: 1 + presence * (leftBrowLeads ? 0.055 : -0.15),
		rightEyeOpen: 1 + presence * (leftBrowLeads ? -0.15 : 0.055),
	};
}
