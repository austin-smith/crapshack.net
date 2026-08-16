import { BLONKY_FPS } from './types';

export const INK_FRAME_SECONDS = 1 / BLONKY_FPS;

const BLINK_PHRASE_SECONDS = 8.75;

export interface BlinkPose {
	leftEyeOpen: number;
	rightEyeOpen: number;
}

export function hash(seed: number, a: number, b = 0): number {
	let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(a, 0xc2b2ae35) + Math.imul(b, 0x27d4eb2f);
	n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
	return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
}

export function smoothstep(value: number): number {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

export function inkFrameTime(value: number): number {
	return Math.round(value * BLONKY_FPS) / BLONKY_FPS;
}

export function heldEnvelope(
	time: number,
	start: number,
	attack: number,
	hold: number,
	release: number,
): number {
	if (time < start || time >= start + attack + hold + release) return 0;
	if (time < start + attack) return smoothstep((time - start) / attack);
	if (time < start + attack + hold) return 1;
	return smoothstep(1 - (time - start - attack - hold) / release);
}

function blinkClosure(time: number, center: number, reach: number): number {
	return smoothstep(1 - Math.abs(time - center) / reach);
}

export function blinkPoseAt(time: number): BlinkPose {
	const phrase = Math.floor(time / BLINK_PHRASE_SECONDS);
	const phraseTime = time - phrase * BLINK_PHRASE_SECONDS;
	const firstBlink = inkFrameTime(0.88 + hash(4021, phrase, 1) * 0.34);
	const secondBlink = inkFrameTime(firstBlink + 0.29 + hash(4021, phrase, 2) * 0.07);
	const regularBlink = inkFrameTime(secondBlink + 1.42 + hash(4021, phrase, 3) * 0.48);
	const centers = [firstBlink, secondBlink, regularBlink];
	let leftClosure = 0;
	let rightClosure = 0;

	for (const center of centers) {
		leftClosure = Math.max(leftClosure, blinkClosure(phraseTime, center, 0.07));
		// The right lid starts with the left but takes a fraction longer to
		// finish reopening. On the stepped ink cadence that becomes one rough,
		// half-open after-frame rather than a smooth tween or a wink.
		rightClosure = Math.max(rightClosure, blinkClosure(phraseTime, center + 0.018, 0.155));
	}

	return {
		leftEyeOpen: 1 - leftClosure,
		rightEyeOpen: 1 - rightClosure,
	};
}
