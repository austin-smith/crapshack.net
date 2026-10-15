import { CRY_LINGER_FRAMES } from '../emotes/cry';
import { heldEnvelope, INK_FRAME_SECONDS } from '../motion';
import { valueNoise } from '../noise';
import type { HeadGeometry } from './head';
import type { Pose } from './pose';
import {
	add,
	mul,
	norm,
	normal,
	polygonBounds,
	quadratic,
	sub,
	type Pt,
} from './points';

export const TEAR_BEAD_RADIUS = 1.65;
export const TEAR_FRONT_RADIUS = 1.15;

export interface TearWell {
	/** The open eye the water is clipped to. */
	eye: Pt[];
	amount: number;
	innerSide: -1 | 1;
	outerX: number;
	innerX: number;
	/** Lowest point of the eye. */
	bottom: number;
	/** Quadratic waterline: start, control, end. */
	waterline: [Pt, Pt, Pt];
	bead: Pt;
}

export interface TearTrack {
	mark: Pt[];
	front: Pt;
}

/** Tears in face space. Track edges tremble with the ink frame. */
export function tearGeometry(pose: Pose, head: HeadGeometry, inkFrame: number): { wells: TearWell[]; tracks: TearTrack[] } {
	const wells: TearWell[] = [];
	const tracks: TearTrack[] = [];
	if (pose.cryElapsed === undefined) return { wells, tracks };
	const cryElapsed = pose.cryElapsed;
	const { leftEye, leftEyeCenter, leftEyeClosed, rightEye, rightEyeCenter, rightEyeClosed } = head;
	const tearWellAt = (delayFrames: number, holdFrames: number): number => heldEnvelope(
		cryElapsed,
		INK_FRAME_SECONDS * delayFrames,
		INK_FRAME_SECONDS * 4,
		INK_FRAME_SECONDS * holdFrames,
		INK_FRAME_SECONDS * 5,
	);
	const leftTearsLead = pose.cryDirection === -1;
	const leftTearWell = tearWellAt(
		leftTearsLead ? 1 : 2,
		(leftTearsLead ? 16 : 15) + CRY_LINGER_FRAMES,
	);
	const rightTearWell = tearWellAt(
		leftTearsLead ? 2 : 1,
		(leftTearsLead ? 15 : 16) + CRY_LINGER_FRAMES,
	);
	const visibleRightTearWell = Math.min(1.1, rightTearWell * 1.1);
	const addWell = (eye: Pt[], center: Pt, amount: number, innerSide: -1 | 1): void => {
		if (amount <= 0.01) return;
		const bounds = polygonBounds(eye);
		const lowerDepth = Math.max(0.8, bounds.maxY - center.y);
		const waterlineY = bounds.maxY - 0.45 - lowerDepth * amount * 0.68;
		const outerX = center.x - innerSide * 7.5;
		const innerX = center.x + innerSide * 10.5;
		wells.push({
			eye,
			amount,
			innerSide,
			outerX,
			innerX,
			bottom: bounds.maxY,
			waterline: [
				{ x: outerX, y: waterlineY + 0.65 },
				{ x: center.x + innerSide * 2, y: waterlineY + 0.15 },
				{ x: innerX, y: waterlineY - 0.7 },
			],
			bead: { x: innerX - innerSide * 0.7, y: waterlineY + 0.4 },
		});
	};
	if (!leftEyeClosed) addWell(leftEye, leftEyeCenter, leftTearWell, 1);
	if (!rightEyeClosed) addWell(rightEye, rightEyeCenter, visibleRightTearWell, -1);

	const addTrack = (
		origin: Pt,
		delayFrames: number,
		durationFrames: number,
		side: -1 | 1,
		route: number,
		id: number,
	): void => {
		const duration = INK_FRAME_SECONDS * durationFrames;
		const age = cryElapsed - INK_FRAME_SECONDS * delayFrames;
		if (age < 0 || age > duration) return;
		const progress = Math.min(1, age / duration);
		const travel = progress ** 1.25;
		const path = quadratic(
			origin,
			{ x: origin.x + side * (1.8 + route * 1.5), y: origin.y + 52 },
			{ x: origin.x + side * (9.5 + route * 4), y: origin.y + 108 },
			32,
		);
		const frontIndex = Math.max(1, Math.round(travel * (path.length - 1)));
		const backIndex = Math.max(0, frontIndex - 2);
		const visibleTrack = path.slice(backIndex, frontIndex + 1);
		const leftEdge: Pt[] = [];
		const rightEdge: Pt[] = [];
		visibleTrack.forEach((point, index) => {
			const before = visibleTrack[Math.max(0, index - 1)];
			const after = visibleTrack[Math.min(visibleTrack.length - 1, index + 1)];
			const n = normal(norm(sub(after, before)));
			const along = visibleTrack.length === 1 ? 1 : index / (visibleTrack.length - 1);
			const liveWobble = (valueNoise(index * 0.7, inkFrame * 0.38, id) - 0.5) * 0.32;
			const radius = Math.max(0.22, 0.3 + along ** 1.5 * 1.15 + liveWobble);
			leftEdge.push(add(point, mul(n, radius)));
			rightEdge.push(add(point, mul(n, -radius)));
		});
		tracks.push({ mark: leftEdge.concat(rightEdge.reverse()), front: visibleTrack.at(-1)! });
	};
	const leftTearOrigin = {
		x: leftEyeCenter.x + 3.2,
		y: Math.max(...leftEye.map((point) => point.y)) - 0.35,
	};
	const rightTearOrigin = {
		x: rightEyeCenter.x - 3.2,
		y: Math.max(...rightEye.map((point) => point.y)) - 0.35,
	};
	const leadingTears = [
		{ delay: 3, duration: 12, route: 0.45, id: 645 },
		{ delay: 12, duration: 11, route: -0.65, id: 646 },
	];
	const followingTears = [
		{ delay: 6, duration: 10, route: -0.2, id: 648 },
	];
	const addSequence = (origin: Pt, side: -1 | 1, sequence: typeof leadingTears): void => {
		for (const tear of sequence) addTrack(origin, tear.delay, tear.duration, side, tear.route, tear.id);
	};
	addSequence(leftTearOrigin, -1, leftTearsLead ? leadingTears : followingTears);
	addSequence(rightTearOrigin, 1, leftTearsLead ? followingTears : leadingTears);
	return { wells, tracks };
}
