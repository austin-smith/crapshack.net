import { heldEnvelope } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

const WAVE_PACE = 0.8;
export const WAVE_DURATION = 5 / WAVE_PACE;
export const WAVE_RELEASE_SECONDS = 1.25;

export function sampleWaveEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	const time = elapsed * WAVE_PACE;
	const lift = heldEnvelope(time, 0.125, 1.5, 1.75, 1.5);
	const greeting = heldEnvelope(time, 1.875, 0.125, 1, 0.25);
	const swing = Math.sin((time - 1.875) * Math.PI * 2 / 0.875) * greeting;
	// Carry loosely gathered fingers, spread near the top, then relax before lowering.
	const openness = heldEnvelope(time, 0.875, 1, 1.375, 0.875);
	const presence = heldEnvelope(time, 0, 0.25, 4.25, 0.5);
	return {
		presence,
		leftWave: direction < 0 ? lift : 0,
		rightWave: direction > 0 ? lift : 0,
		leftWaveSwing: direction < 0 ? swing : 0,
		rightWaveSwing: direction > 0 ? swing : 0,
		leftWaveFingers: direction < 0 ? openness : 0,
		rightWaveFingers: direction > 0 ? openness : 0,
		headX: -direction * lift * 1.1,
		headY: 0,
		headAngle: -direction * lift * 0.006,
		headTurn: 0,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: -direction * lift * 2,
		shoulderY: -lift * 2,
		torsoY: 0,
		shoulderTilt: direction * lift * 1.5,
		bellySpread: 0,
		mouthPurse: 0,
		mouthTension: 0,
		mouthCurl: 0,
		leftBrowLift: 0,
		rightBrowLift: 0,
		leftBrowArch: 0,
		rightBrowArch: 0,
		// Leave his ordinary, slightly uneven eyes alone. This is a greeting,
		// not a second smile expression.
		leftEyeOpen: 1,
		rightEyeOpen: 1,
	};
}
