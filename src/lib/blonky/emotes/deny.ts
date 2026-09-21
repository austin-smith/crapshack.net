import { heldEnvelope, INK_FRAME_SECONDS, smoothstep } from '../motion';
import type { BlonkyEmoteOffset } from '../types';

// One reversal per frame at the start, damping as conviction runs out. Faster
// and shallower than smh's deliberate sweeps.
const SHAKE_KEYS = [0, 1, -1, 0.9, -0.85, 0.7, -0.55, 0.35, -0.18, 0];
const SHAKE_START_FRAME = 2;

function shakeAt(elapsed: number): number {
	const frame = elapsed / INK_FRAME_SECONDS - SHAKE_START_FRAME;
	if (frame <= 0 || frame >= SHAKE_KEYS.length - 1) return 0;
	const index = Math.floor(frame);
	const amount = smoothstep(frame - index);
	return SHAKE_KEYS[index] + (SHAKE_KEYS[index + 1] - SHAKE_KEYS[index]) * amount;
}

export function sampleDenyEmote(elapsed: number, direction: -1 | 1): BlonkyEmoteOffset {
	// Brows shoot up and the head recoils before the shake begins; the wide-eyed
	// alarm outlasts the shake, and the shoulders drop in a late exhale so the
	// settle still reads as rattled. The brow on the shake's leading side jumps a
	// frame before the other.
	const alarm = heldEnvelope(
		elapsed,
		0,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 4,
	);
	const lagAlarm = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 8,
		INK_FRAME_SECONDS * 3,
	);
	const brace = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS,
		INK_FRAME_SECONDS * 2,
		INK_FRAME_SECONDS * 7,
		INK_FRAME_SECONDS * 4,
	);
	const settle = heldEnvelope(
		elapsed,
		INK_FRAME_SECONDS * 12,
		INK_FRAME_SECONDS,
		0,
		INK_FRAME_SECONDS * 2,
	);
	const shake = direction * shakeAt(elapsed);
	const leftLeads = direction < 0;
	const leadBrowLift = alarm * 5.4;
	const lagBrowLift = lagAlarm * 4.4;
	const leadBrowArch = alarm * 1.8;
	const lagBrowArch = lagAlarm * 1.4;
	const leadEyeOpen = 1 + alarm * 0.19;
	const lagEyeOpen = 1 + lagAlarm * 0.16;

	return {
		presence: Math.max(alarm, brace, settle),
		armTension: brace * 0.035,
		headX: shake * 0.35,
		headY: -alarm * 0.9 + settle * 0.8,
		headAngle: shake * 0.006,
		headTurn: shake * 1.3,
		faceLookY: 0,
		eyeLookY: 0,
		bodyX: shake * -0.5,
		shoulderY: -brace * 3.2 + settle * 2.4,
		torsoY: -brace * 0.8 + settle * 0.7,
		shoulderTilt: shake * -0.4,
		bellySpread: settle * 0.8,
		mouthPurse: alarm * 0.34,
		mouthTension: shake * 0.05,
		mouthFrown: alarm * 0.55,
		leftBrowLift: leftLeads ? leadBrowLift : lagBrowLift,
		rightBrowLift: leftLeads ? lagBrowLift : leadBrowLift,
		leftBrowArch: leftLeads ? leadBrowArch : lagBrowArch,
		rightBrowArch: leftLeads ? lagBrowArch : leadBrowArch,
		mouthCurl: 0,
		leftEyeOpen: leftLeads ? leadEyeOpen : lagEyeOpen,
		rightEyeOpen: leftLeads ? lagEyeOpen : leadEyeOpen,
	};
}
